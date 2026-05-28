const { run } = require("hardhat");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDeployment(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function checkVerifierConnectivity() {
  // Use the same HTTP client stack as hardhat-verify (undici), and honor proxy env if provided.
  const url = new URL(
    "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET" +
      "?module=contract&action=getsourcecode&address=0x0000000000000000000000000000000000000000&apikey=empty"
  );

  try {
    const { request, ProxyAgent, getGlobalDispatcher } = require("undici");
    const dispatcher = process.env.http_proxy
      ? new ProxyAgent(process.env.http_proxy)
      : getGlobalDispatcher();

    const res = await request(url, {
      method: "GET",
      dispatcher,
      headersTimeout: 12000,
      bodyTimeout: 12000
    });

    return {
      ok: true,
      host: url.host,
      statusCode: res.statusCode
    };
  } catch (e) {
    return {
      ok: false,
      reason: `Cannot reach verifier endpoint ${url.toString()}: ${e.code || ""} ${e.message || e}`.trim()
    };
  }
}

async function verifyWithRetry(address, constructorArguments, label, contract, retries = 3, waitMs = 20000) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      console.log(`Verifying ${label} (${attempt}/${retries})...`);
      const payload = { address, constructorArguments };
      if (contract) payload.contract = contract;
      await run("verify:verify", payload);
      console.log(`${label}: verified`);
      return true;
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      console.log(`${label}: verify failed -> ${msg}`);
      if (msg.toLowerCase().includes("already verified")) {
        console.log(`${label}: already verified`);
        return true;
      }

      if (attempt < retries) {
        console.log(`Retry in ${waitMs / 1000}s...`);
        await sleep(waitMs);
      }
    }
  }
  return false;
}

async function main() {
  const networkName = process.env.DEPLOYMENT_NETWORK || "xlayerTestnet";
  const deploymentsDir = path.join(process.cwd(), "deployments");
  const deploymentFile =
    process.env.DEPLOYMENT_FILE || path.join(deploymentsDir, `v4-${networkName}-latest.json`);

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}`);
  }

  const d = readDeployment(deploymentFile);
  console.log("Using deployment file:", deploymentFile);

  const net = await checkVerifierConnectivity();
  if (!net.ok) {
    throw new Error(
      `Preflight failed: ${net.reason}\n` +
        "Fix network reachability to www.oklink.com:443 first (proxy/firewall/DNS), then retry verification."
    );
  }
  console.log(`Verifier reachability OK: ${net.host} -> ${net.address}, HTTP ${net.statusCode}`);

  const ok = [];
  ok.push(
    await verifyWithRetry(
      d.addresses.poolManager,
      [d.deployer],
      "V4PoolManager",
      "contracts/v4/V4PoolManager.sol:V4PoolManager"
    )
  );
  ok.push(
    await verifyWithRetry(
      d.addresses.registry,
      [d.deployer],
      "AgentQuoteRegistry",
      "contracts/AgentQuoteRegistry.sol:AgentQuoteRegistry"
    )
  );
  ok.push(
    await verifyWithRetry(
      d.addresses.create2Factory,
      [],
      "DeterministicCreate2Factory",
      "contracts/v4/DeterministicCreate2Factory.sol:DeterministicCreate2Factory"
    )
  );
  ok.push(
    await verifyWithRetry(
      d.addresses.flowExecutor,
      [d.addresses.poolManager],
      "V4FlowExecutor",
      "contracts/v4/V4FlowExecutor.sol:V4FlowExecutor"
    )
  );
  ok.push(
    await verifyWithRetry(
      d.addresses.token0,
      [BigInt(process.env.V4_TOKEN_MINT_AMOUNT || "1000000000000000000000000")],
      "TestERC20Mintable token0",
      "contracts/v4/TestERC20Mintable.sol:TestERC20Mintable"
    )
  );
  ok.push(
    await verifyWithRetry(
      d.addresses.token1,
      [BigInt(process.env.V4_TOKEN_MINT_AMOUNT || "1000000000000000000000000")],
      "TestERC20Mintable token1",
      "contracts/v4/TestERC20Mintable.sol:TestERC20Mintable"
    )
  );
  ok.push(
    await verifyWithRetry(
      d.addresses.hook,
      [d.addresses.poolManager, d.addresses.registry, BigInt(d.params.directSettleThreshold)],
      "ArenaV4Hook",
      "contracts/ArenaV4Hook.sol:ArenaV4Hook"
    )
  );

  if (ok.some((v) => !v)) {
    throw new Error(
      "Some contracts failed verification. If logs are ECONNRESET/Connect Timeout, root cause is verifier network connectivity, not constructor args."
    );
  }

  console.log("All v4 contracts verified.");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
