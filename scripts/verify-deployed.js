const { run } = require("hardhat");
const fs = require("fs");
const path = require("path");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readDeployment(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function verifyWithRetry(address, constructorArguments, label, retries = 3, waitMs = 15000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`Verifying ${label} (attempt ${attempt}/${retries})...`);
      await run("verify:verify", { address, constructorArguments });
      console.log(`${label} verified`);
      return true;
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      console.log(`${label} verify failed: ${msg}`);

      const alreadyVerified = msg.toLowerCase().includes("already verified");
      if (alreadyVerified) {
        console.log(`${label} already verified`);
        return true;
      }

      if (attempt < retries) {
        console.log(`Retrying in ${waitMs / 1000}s...`);
        await sleep(waitMs);
      }
    }
  }
  return false;
}

async function main() {
  const networkName = process.env.DEPLOYMENT_NETWORK || "xlayerTestnet";
  const deploymentsDir = path.join(process.cwd(), "deployments");
  const deploymentFile = process.env.DEPLOYMENT_FILE || path.join(deploymentsDir, `${networkName}-latest.json`);

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(`Deployment file not found: ${deploymentFile}`);
  }

  const d = readDeployment(deploymentFile);
  console.log("Using deployment file:", deploymentFile);

  const okRegistry = await verifyWithRetry(
    d.registryAddress,
    [d.deployer],
    "AgentQuoteRegistry"
  );

  const okHook = await verifyWithRetry(
    d.hookAddress,
    [d.registryAddress, BigInt(d.directSettleThreshold)],
    "ArenaHook"
  );

  if (!okRegistry || !okHook) {
    throw new Error("Verification not fully successful");
  }

  console.log("All verification steps completed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
