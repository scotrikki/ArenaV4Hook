const hre = require("hardhat");
const { ethers } = hre;
const fs = require("fs");
const path = require("path");

const HOOK_FLAGS = (1n << 7n) | (1n << 6n); // beforeSwap + afterSwap = 0xC0
const FLAG_MASK = (1n << 14n) - 1n;
const MAX_SALT_TRIES = 250000;

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

async function main() {
  const [owner, user, agent] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;

  console.log("Network:", hre.network.name);
  console.log("ChainId:", chainId.toString());
  console.log("Owner:", owner.address);
  console.log("User:", user.address);
  console.log("Agent:", agent.address);

  const deployAmount = ethers.parseEther("1000000");
  const swapAmountIn = 5000n;
  const quotedAmountOut = 5200n;
  const minAmountOut = 4500n;
  const quoteWindowSec = 120n;
  const quoteValidSec = 90n;
  const fee = 3000;
  const tickSpacing = 60;
  const sqrtPriceX96 = 2n ** 96n; // price = 1

  const V4PoolManager = await ethers.getContractFactory("V4PoolManager");
  const poolManager = await V4PoolManager.deploy(owner.address);
  await poolManager.waitForDeployment();

  const TestERC20Mintable = await ethers.getContractFactory("TestERC20Mintable");
  const tokenA = await TestERC20Mintable.deploy(deployAmount);
  await tokenA.waitForDeployment();
  const tokenB = await TestERC20Mintable.deploy(deployAmount);
  await tokenB.waitForDeployment();

  const tokenAAddr = await tokenA.getAddress();
  const tokenBAddr = await tokenB.getAddress();

  if (BigInt(tokenAAddr) === BigInt(tokenBAddr)) {
    throw new Error("Token addresses are equal");
  }

  const [currency0Addr, currency1Addr] =
    BigInt(tokenAAddr) < BigInt(tokenBAddr) ? [tokenAAddr, tokenBAddr] : [tokenBAddr, tokenAAddr];
  const tokenByAddress = new Map([
    [tokenAAddr.toLowerCase(), tokenA],
    [tokenBAddr.toLowerCase(), tokenB]
  ]);
  const token0 = tokenByAddress.get(currency0Addr.toLowerCase());
  const token1 = tokenByAddress.get(currency1Addr.toLowerCase());
  if (!token0 || !token1) {
    throw new Error("Failed to map token contracts by address");
  }

  const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
  const registry = await AgentQuoteRegistry.deploy(owner.address);
  await registry.waitForDeployment();

  const DeterministicCreate2Factory = await ethers.getContractFactory("DeterministicCreate2Factory");
  const c2factory = await DeterministicCreate2Factory.deploy();
  await c2factory.waitForDeployment();

  const poolManagerAddr = await poolManager.getAddress();
  const registryAddr = await registry.getAddress();
  const directSettleThreshold = 1000n;

  const ArenaV4Hook = await ethers.getContractFactory("ArenaV4Hook");
  const hookTxReq = await ArenaV4Hook.getDeployTransaction(poolManagerAddr, registryAddr, directSettleThreshold);
  const hookCreationCode = hookTxReq.data;
  if (!hookCreationCode) {
    throw new Error("No hook creation code");
  }

  const { salt, predicted, tries } = await mineHookSalt(await c2factory.getAddress(), hookCreationCode);
  console.log("Hook salt mined in tries:", tries);
  console.log("Predicted hook:", predicted);

  const deployHookTx = await c2factory.deploy(salt, hookCreationCode);
  await deployHookTx.wait();

  const hookCode = await ethers.provider.getCode(predicted);
  if (hookCode === "0x") {
    throw new Error("Hook deployment failed");
  }

  const hook = ArenaV4Hook.attach(predicted);
  console.log("Hook deployed:", await hook.getAddress());

  await (await registry.setHook(await hook.getAddress())).wait();
  await (await registry.setAgentWhitelist(agent.address, true)).wait();

  const V4FlowExecutor = await ethers.getContractFactory("V4FlowExecutor");
  const executor = await V4FlowExecutor.deploy(poolManagerAddr);
  await executor.waitForDeployment();

  // fund executor itself; during unlock callback, PoolManager accounts deltas to executor address
  await (await token0.transfer(user.address, 10_000_000n)).wait();
  await (await token1.transfer(user.address, 10_000_000n)).wait();
  await (await token0.transfer(await executor.getAddress(), 2_000_000n)).wait();
  await (await token1.transfer(await executor.getAddress(), 2_000_000n)).wait();
  console.log("Executor:", await executor.getAddress());
  console.log("Token0:", currency0Addr);
  console.log("Token1:", currency1Addr);

  const poolKey = {
    currency0: currency0Addr,
    currency1: currency1Addr,
    fee,
    tickSpacing,
    hooks: await hook.getAddress()
  };

  const initTx = await poolManager.initialize(poolKey, sqrtPriceX96);
  const initRcpt = await initTx.wait();
  console.log("Pool initialized tx:", initRcpt.hash);

  const modifyParams = {
    tickLower: -600,
    tickUpper: 600,
    liquidityDelta: 1_000_000n,
    salt: ethers.ZeroHash
  };

  const addLiqTx = await executor.modifyLiquidity(poolKey, modifyParams, "0x");
  const addLiqRcpt = await addLiqTx.wait();
  console.log("Add liquidity tx:", addLiqRcpt.hash);

  const nowBlock = await ethers.provider.getBlock("latest");
  const quoteDeadline = BigInt(nowBlock.timestamp) + quoteWindowSec;
  const validUntil = BigInt(nowBlock.timestamp) + quoteValidSec;

  const requestId = await hook.computeRequestId(owner.address, swapAmountIn, currency0Addr, currency1Addr, true);
  const nonce = await hook.agentNonces(agent.address);
  const digest = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
    [await hook.getAddress(), chainId, requestId, quotedAmountOut, validUntil, nonce]
  );
  const signature = await agent.signMessage(ethers.getBytes(digest));

  const hookData = ethers.AbiCoder.defaultAbiCoder().encode(
    [
      "tuple(address user,address agent,uint256 amountOut,uint256 minAmountOut,uint64 quoteDeadline,uint64 validUntil,uint256 nonce,bytes signature)"
    ],
    [
      {
        user: owner.address,
        agent: agent.address,
        amountOut: quotedAmountOut,
        minAmountOut,
        quoteDeadline,
        validUntil,
        nonce,
        signature
      }
    ]
  );

  const swapParams = {
    zeroForOne: true,
    amountSpecified: -swapAmountIn,
    sqrtPriceLimitX96: 4295128740n // MIN_SQRT_PRICE + 1
  };

  const swapTx = await executor.swap(poolKey, swapParams, hookData);
  const swapRcpt = await swapTx.wait();
  console.log("Swap tx:", swapRcpt.hash);

  const hookIface = hook.interface;
  const parsed = [];
  for (const log of swapRcpt.logs) {
    try {
      const p = hookIface.parseLog(log);
      if (p) parsed.push(p);
    } catch {
      // ignore non-hook logs
    }
  }

  const names = parsed.map((x) => x.name);
  const opened = parsed.find((x) => x.name === "QuoteWindowOpened");
  const submitted = parsed.find((x) => x.name === "QuoteSubmitted");
  const selected = parsed.find((x) => x.name === "QuoteSelected");
  const quality = parsed.find((x) => x.name === "SwapQualityRecorded");

  console.log("Hook events:", names.join(", "));
  if (!opened || !submitted || !selected || !quality) {
    throw new Error("Missing expected hook events from real swap");
  }

  const agentStats = await registry.agentStats(agent.address);
  const out = {
    generatedAt: new Date().toISOString(),
    network: hre.network.name,
    chainId: chainId.toString(),
    deployer: owner.address,
    user: user.address,
    agent: agent.address,
    poolManager: poolManagerAddr,
    token0: currency0Addr,
    token1: currency1Addr,
    registry: registryAddr,
    create2Factory: await c2factory.getAddress(),
    hook: await hook.getAddress(),
    hookSalt: salt,
    hookFlagLow14: `0x${(BigInt(await hook.getAddress()) & FLAG_MASK).toString(16)}`,
    flowExecutor: await executor.getAddress(),
    txs: {
      initialize: initRcpt.hash,
      addLiquidity: addLiqRcpt.hash,
      swap: swapRcpt.hash
    },
    selectedAgent: selected.args.agent,
    selectedAmountOut: selected.args.amountOut.toString(),
    quality: {
      baselineAmountOut: quality.args.baselineAmountOut.toString(),
      finalAmountOut: quality.args.finalAmountOut.toString(),
      improvementBps: quality.args.improvementBps.toString(),
      quoteCount: quality.args.quoteCount.toString(),
      latencySeconds: quality.args.latencySeconds.toString(),
      usedFallback: quality.args.usedFallback
    },
    agentStats: {
      submissions: agentStats.submissions.toString(),
      wins: agentStats.wins.toString(),
      cumulativePositiveImprovementBps: agentStats.cumulativePositiveImprovementBps.toString()
    }
  };

  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });
  const outPath = path.join(deploymentsDir, `v4-local-flow-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

  console.log("\nV4_LOCAL_FLOW_RESULT");
  console.log(JSON.stringify(out, null, 2));
  console.log("\nSaved:", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
