const hre = require("hardhat");
const { ethers, network } = hre;
const fs = require("fs");
const path = require("path");

const HOOK_FLAGS = (1n << 7n) | (1n << 6n); // beforeSwap + afterSwap = 0xC0
const FLAG_MASK = (1n << 14n) - 1n;
const MAX_SALT_TRIES = Number(process.env.HOOK_SALT_MAX_TRIES || 300000);

function computeCreate2(deployer, saltBytes32, initCodeHash) {
  const packed = ethers.solidityPacked(
    ["bytes1", "address", "bytes32", "bytes32"],
    ["0xff", deployer, saltBytes32, initCodeHash]
  );
  const hash = ethers.keccak256(packed);
  return ethers.getAddress(`0x${hash.slice(-40)}`);
}

async function mineHookSalt(factoryAddress, hookCreationCodeWithArgs) {
  const initCodeHash = ethers.keccak256(hookCreationCodeWithArgs);

  for (let i = 0; i < MAX_SALT_TRIES; i += 1) {
    const salt = ethers.zeroPadValue(ethers.toBeHex(i), 32);
    const predicted = computeCreate2(factoryAddress, salt, initCodeHash);
    const lowBits = BigInt(predicted) & FLAG_MASK;
    if (lowBits === HOOK_FLAGS) {
      return { salt, predicted, tries: i + 1 };
    }
  }

  throw new Error(`Hook salt not found in ${MAX_SALT_TRIES} tries`);
}

function saveDeployment(networkName, payload) {
  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filePath = path.join(deploymentsDir, `v4-${networkName}-${payload.chainId}-${stamp}.json`);
  const latestPath = path.join(deploymentsDir, `v4-${networkName}-latest.json`);

  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  fs.writeFileSync(latestPath, JSON.stringify(payload, null, 2));

  return { filePath, latestPath };
}

async function sleep(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

async function waitForTx(txPromise, label, minDelayMs = 800) {
  const tx = await txPromise;
  const rcpt = await tx.wait();
  console.log(`${label}: ${rcpt.hash}`);
  if (minDelayMs > 0) {
    await sleep(minDelayMs);
  }
  return rcpt;
}

async function main() {
  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signer available from Hardhat");
  }
  const deployer = signers[0];
  const agentMaybe = signers[1] || signers[0];
  const net = await ethers.provider.getNetwork();
  const chainId = net.chainId;

  if (network.name !== "xlayerTestnet" && network.name !== "xlayer") {
    throw new Error(`Use --network xlayerTestnet or xlayer, current: ${network.name}`);
  }

  console.log("Network:", network.name);
  console.log("ChainId:", chainId.toString());
  console.log("Deployer:", deployer.address);

  const deployAmount = BigInt(process.env.V4_TOKEN_MINT_AMOUNT || "1000000000000000000000000");
  const directSettleThreshold = BigInt(process.env.V4_DIRECT_SETTLE_THRESHOLD || "1000");
  const fee = Number(process.env.V4_POOL_FEE || 3000);
  const tickSpacing = Number(process.env.V4_TICK_SPACING || 60);
  const sqrtPriceX96 = BigInt(process.env.V4_INIT_SQRT_PRICE_X96 || (2n ** 96n).toString());

  const liquidityDelta = BigInt(process.env.V4_LIQUIDITY_DELTA || "1000000");
  const tickLower = Number(process.env.V4_TICK_LOWER || -600);
  const tickUpper = Number(process.env.V4_TICK_UPPER || 600);

  const swapAmountIn = BigInt(process.env.V4_SWAP_AMOUNT_IN || "5000");
  const quotedAmountOut = BigInt(process.env.V4_QUOTED_AMOUNT_OUT || "5200");
  const minAmountOut = BigInt(process.env.V4_MIN_AMOUNT_OUT || "4500");
  const quoteWindowSec = BigInt(process.env.V4_QUOTE_WINDOW_SEC || "120");
  const quoteValidSec = BigInt(process.env.V4_QUOTE_VALID_SEC || "90");

  const quoteAgent =
    process.env.V4_QUOTE_AGENT && process.env.V4_QUOTE_AGENT.trim()
      ? ethers.getAddress(process.env.V4_QUOTE_AGENT.trim())
      : agentMaybe.address;
  const quoteSigner = quoteAgent.toLowerCase() === deployer.address.toLowerCase() ? deployer : agentMaybe;

  console.log("Quote agent:", quoteAgent);
  if (quoteSigner.address.toLowerCase() !== quoteAgent.toLowerCase()) {
    console.log("WARNING: quote signer in local signer list does not match quote agent address.");
    console.log("The script will sign with available signer:", quoteSigner.address);
  }

  const V4PoolManager = await ethers.getContractFactory("V4PoolManager");
  const poolManager = await V4PoolManager.deploy(deployer.address);
  await poolManager.waitForDeployment();
  console.log("V4PoolManager:", await poolManager.getAddress());

  const TestERC20Mintable = await ethers.getContractFactory("TestERC20Mintable");
  const tokenA = await TestERC20Mintable.deploy(deployAmount);
  await tokenA.waitForDeployment();
  const tokenB = await TestERC20Mintable.deploy(deployAmount);
  await tokenB.waitForDeployment();
  const tokenAAddr = await tokenA.getAddress();
  const tokenBAddr = await tokenB.getAddress();
  console.log("TokenA:", tokenAAddr);
  console.log("TokenB:", tokenBAddr);

  const [currency0Addr, currency1Addr] =
    BigInt(tokenAAddr) < BigInt(tokenBAddr) ? [tokenAAddr, tokenBAddr] : [tokenBAddr, tokenAAddr];
  const tokenByAddress = new Map([
    [tokenAAddr.toLowerCase(), tokenA],
    [tokenBAddr.toLowerCase(), tokenB]
  ]);
  const token0 = tokenByAddress.get(currency0Addr.toLowerCase());
  const token1 = tokenByAddress.get(currency1Addr.toLowerCase());
  if (!token0 || !token1) {
    throw new Error("Failed to map token contracts");
  }
  console.log("currency0:", currency0Addr);
  console.log("currency1:", currency1Addr);

  const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
  const registry = await AgentQuoteRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("AgentQuoteRegistry:", await registry.getAddress());

  const DeterministicCreate2Factory = await ethers.getContractFactory("DeterministicCreate2Factory");
  const c2factory = await DeterministicCreate2Factory.deploy();
  await c2factory.waitForDeployment();
  console.log("DeterministicCreate2Factory:", await c2factory.getAddress());

  const ArenaV4Hook = await ethers.getContractFactory("ArenaV4Hook");
  const hookDeployTxReq = await ArenaV4Hook.getDeployTransaction(
    await poolManager.getAddress(),
    await registry.getAddress(),
    directSettleThreshold
  );
  const hookCreationCode = hookDeployTxReq.data;
  if (!hookCreationCode) {
    throw new Error("Missing hook creation code");
  }

  const { salt, predicted, tries } = await mineHookSalt(await c2factory.getAddress(), hookCreationCode);
  console.log("Hook salt tries:", tries);
  console.log("Predicted hook:", predicted);

  await waitForTx(c2factory.deploy(salt, hookCreationCode), "Deploy hook (CREATE2)");

  const deployedCode = await ethers.provider.getCode(predicted);
  if (deployedCode === "0x") {
    throw new Error("Hook not deployed");
  }

  const hook = ArenaV4Hook.attach(predicted);
  console.log("ArenaV4Hook:", await hook.getAddress());
  console.log("Hook low14 flags:", `0x${(BigInt(await hook.getAddress()) & FLAG_MASK).toString(16)}`);

  await waitForTx(registry.setHook(await hook.getAddress()), "Registry setHook");
  await waitForTx(registry.setAgentWhitelist(quoteAgent, true), "Whitelist quote agent");

  const V4FlowExecutor = await ethers.getContractFactory("V4FlowExecutor");
  const executor = await V4FlowExecutor.deploy(await poolManager.getAddress());
  await executor.waitForDeployment();
  console.log("V4FlowExecutor:", await executor.getAddress());

  // fund executor wallet for settlement inside unlock callback
  await waitForTx(token0.transfer(await executor.getAddress(), 2_000_000n), "Fund executor token0");
  await waitForTx(token1.transfer(await executor.getAddress(), 2_000_000n), "Fund executor token1");

  const poolKey = {
    currency0: currency0Addr,
    currency1: currency1Addr,
    fee,
    tickSpacing,
    hooks: await hook.getAddress()
  };

  const initRcpt = await waitForTx(poolManager.initialize(poolKey, sqrtPriceX96), "Initialize pool");

  const modifyParams = {
    tickLower,
    tickUpper,
    liquidityDelta,
    salt: ethers.ZeroHash
  };
  const addLiqRcpt = await waitForTx(executor.modifyLiquidity(poolKey, modifyParams, "0x"), "Add liquidity");

  const nowBlock = await ethers.provider.getBlock("latest");
  const quoteDeadline = BigInt(nowBlock.timestamp) + quoteWindowSec;
  const validUntil = BigInt(nowBlock.timestamp) + quoteValidSec;
  const requestSalt = ethers.keccak256(
    ethers.solidityPacked(["address", "uint256", "uint64"], [deployer.address, swapAmountIn, nowBlock.timestamp])
  );

  const requestId = await hook.computeRequestIdWithSalt(
    deployer.address,
    swapAmountIn,
    currency0Addr,
    currency1Addr,
    true,
    requestSalt
  );
  const nonce = await hook.agentNonces(quoteAgent);
  const digest = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
    [await hook.getAddress(), chainId, requestId, quotedAmountOut, validUntil, nonce]
  );
  const signature = await quoteSigner.signMessage(ethers.getBytes(digest));

  const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(address user,address agent,uint256 amountOut,uint256 minAmountOut,uint64 quoteDeadline,uint64 validUntil,uint256 nonce,bytes32 requestSalt,bytes signature)"
    ],
    [
      {
        user: deployer.address,
        agent: quoteAgent,
        amountOut: quotedAmountOut,
        minAmountOut,
        quoteDeadline,
        validUntil,
        nonce,
        requestSalt,
        signature
      }
    ]
  );

  const swapParams = {
    zeroForOne: true,
    amountSpecified: -swapAmountIn,
    sqrtPriceLimitX96: 4295128740n // MIN_SQRT_PRICE + 1
  };
  const swapRcpt = await waitForTx(executor.swap(poolKey, swapParams, hookData), "Swap");

  const hookIface = hook.interface;
  const hookEvents = [];
  for (const log of swapRcpt.logs) {
    try {
      const parsed = hookIface.parseLog(log);
      if (parsed) hookEvents.push(parsed);
    } catch {
      // ignore unrelated logs
    }
  }

  const opened = hookEvents.find((e) => e.name === "QuoteWindowOpened");
  const submitted = hookEvents.find((e) => e.name === "QuoteSubmitted");
  const selected = hookEvents.find((e) => e.name === "QuoteSelected");
  const quality = hookEvents.find((e) => e.name === "SwapQualityRecorded");

  if (!opened || !submitted || !selected || !quality) {
    throw new Error("Swap executed, but expected hook events are incomplete");
  }

  const agentStats = await registry.agentStats(quoteAgent);
  const payload = {
    generatedAt: new Date().toISOString(),
    network: network.name,
    chainId: chainId.toString(),
    deployer: deployer.address,
    quoteAgent,
    addresses: {
      poolManager: await poolManager.getAddress(),
      token0: currency0Addr,
      token1: currency1Addr,
      registry: await registry.getAddress(),
      create2Factory: await c2factory.getAddress(),
      hook: await hook.getAddress(),
      flowExecutor: await executor.getAddress()
    },
    params: {
      fee,
      tickSpacing,
      sqrtPriceX96: sqrtPriceX96.toString(),
      liquidityDelta: liquidityDelta.toString(),
      tickLower,
      tickUpper,
      directSettleThreshold: directSettleThreshold.toString(),
      swapAmountIn: swapAmountIn.toString(),
      quotedAmountOut: quotedAmountOut.toString(),
      minAmountOut: minAmountOut.toString()
    },
    hookMining: {
      salt,
      tries,
      hookFlagLow14: `0x${(BigInt(await hook.getAddress()) & FLAG_MASK).toString(16)}`
    },
    txs: {
      initialize: initRcpt.hash,
      addLiquidity: addLiqRcpt.hash,
      swap: swapRcpt.hash
    },
    hookEvents: {
      quoteWindowOpened: true,
      quoteSubmitted: true,
      quoteSelected: {
        agent: selected.args.agent,
        amountOut: selected.args.amountOut.toString()
      },
      swapQualityRecorded: {
        baselineAmountOut: quality.args.baselineAmountOut.toString(),
        finalAmountOut: quality.args.finalAmountOut.toString(),
        improvementBps: quality.args.improvementBps.toString(),
        quoteCount: quality.args.quoteCount.toString(),
        latencySeconds: quality.args.latencySeconds.toString(),
        usedFallback: quality.args.usedFallback
      }
    },
    agentStats: {
      submissions: agentStats.submissions.toString(),
      wins: agentStats.wins.toString(),
      cumulativePositiveImprovementBps: agentStats.cumulativePositiveImprovementBps.toString()
    }
  };

  const { filePath, latestPath } = saveDeployment(network.name, payload);
  console.log("\nV4_XLAYER_RESULT");
  console.log(JSON.stringify(payload, null, 2));
  console.log("\nSaved:");
  console.log(filePath);
  console.log(latestPath);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
