const { ethers, network, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();

  console.log("Network:", network.name);
  console.log("ChainId:", (await ethers.provider.getNetwork()).chainId.toString());
  console.log("Deployer:", deployer.address);

  const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
  const registry = await AgentQuoteRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("AgentQuoteRegistry:", registryAddress);

  const directSettleThreshold = 1000n;
  const ArenaHook = await ethers.getContractFactory("ArenaHook");
  const hook = await ArenaHook.deploy(registryAddress, directSettleThreshold);
  await hook.waitForDeployment();
  const hookAddress = await hook.getAddress();
  console.log("ArenaHook:", hookAddress);

  await (await registry.setHook(hookAddress)).wait();
  console.log("Registry hook linked");

  const whitelist = process.env.WHITELIST_AGENTS
    ? process.env.WHITELIST_AGENTS.split(",").map((a) => a.trim()).filter(Boolean)
    : [];

  for (const agent of whitelist) {
    await (await registry.setAgentWhitelist(agent, true)).wait();
    console.log("Whitelisted:", agent);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    network: network.name,
    chainId: (await ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    registryAddress,
    hookAddress,
    directSettleThreshold: directSettleThreshold.toString(),
    whitelistedAgents: whitelist
  };

  const deploymentsDir = path.join(process.cwd(), "deployments");
  fs.mkdirSync(deploymentsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${network.name}-${output.chainId}-${stamp}.json`;
  const filePath = path.join(deploymentsDir, fileName);
  fs.writeFileSync(filePath, JSON.stringify(output, null, 2));

  const latestPath = path.join(deploymentsDir, `${network.name}-latest.json`);
  fs.writeFileSync(latestPath, JSON.stringify(output, null, 2));

  console.log("\nDEPLOYMENT_RESULT");
  console.log(JSON.stringify(output, null, 2));
  console.log("\nSaved:");
  console.log(filePath);
  console.log(latestPath);

  if (process.env.AUTO_VERIFY === "true") {
    console.log("\nStarting source verification...");
    try {
      await run("verify:verify", {
        address: registryAddress,
        constructorArguments: [deployer.address]
      });
    } catch (e) {
      console.log("Registry verify warning:", e.message || e);
    }

    try {
      await run("verify:verify", {
        address: hookAddress,
        constructorArguments: [registryAddress, directSettleThreshold]
      });
    } catch (e) {
      console.log("Hook verify warning:", e.message || e);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
