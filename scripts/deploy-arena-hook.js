const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
  const registry = await AgentQuoteRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  console.log("AgentQuoteRegistry deployed to:", await registry.getAddress());

  const ArenaHook = await ethers.getContractFactory("ArenaHook");
  const hook = await ArenaHook.deploy(await registry.getAddress(), 1000n);
  await hook.waitForDeployment();

  await (await registry.setHook(await hook.getAddress())).wait();
  console.log("ArenaHook deployed to:", await hook.getAddress());
  console.log("Registry hook set:", await hook.getAddress());

  // Optional sample whitelist setup for local demo.
  const agents = (await ethers.getSigners()).slice(1, 4);
  for (const agent of agents) {
    const tx = await registry.setAgentWhitelist(agent.address, true);
    await tx.wait();
    console.log("Whitelisted agent:", agent.address);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
