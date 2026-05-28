const { ethers } = require("hardhat");

async function main() {
  const [owner, user, agent1, agent2] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  const chainId = network.chainId;

  const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
  const registry = await AgentQuoteRegistry.deploy(owner.address);
  await registry.waitForDeployment();

  const ArenaHook = await ethers.getContractFactory("ArenaHook");
  const hook = await ArenaHook.deploy(await registry.getAddress(), 1000n);
  await hook.waitForDeployment();
  await (await registry.setHook(await hook.getAddress())).wait();

  await (await registry.setAgentWhitelist(agent1.address, true)).wait();
  await (await registry.setAgentWhitelist(agent2.address, true)).wait();

  console.log("Registry:", await registry.getAddress());
  console.log("ArenaHook:", await hook.getAddress());
  console.log("Agent1:", agent1.address);
  console.log("Agent2:", agent2.address);

  const openTx = await hook.connect(user).openQuoteWindow(
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    5000n,
    4500n,
    60
  );
  const openReceipt = await openTx.wait();
  const requestId = await hook.computeRequestId(user.address, openReceipt.blockNumber, 5000n);
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const validUntil = now + 30;

  const d1 = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
    [await hook.getAddress(), chainId, requestId, 5100n, validUntil, 0n]
  );
  const d2 = ethers.solidityPackedKeccak256(
    ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
    [await hook.getAddress(), chainId, requestId, 5200n, validUntil, 0n]
  );

  const sig1 = await agent1.signMessage(ethers.getBytes(d1));
  const sig2 = await agent2.signMessage(ethers.getBytes(d2));

  await (await hook.connect(user).submitQuote(requestId, agent1.address, 5100n, validUntil, 0n, sig1)).wait();
  await (await hook.connect(user).submitQuote(requestId, agent2.address, 5200n, validUntil, 0n, sig2)).wait();

  const settleTx = await hook.connect(user).settleRequest(requestId, 5000n, 130000n);
  const settleReceipt = await settleTx.wait();

  const iface = hook.interface;
  for (const raw of settleReceipt.logs) {
    try {
      const parsed = iface.parseLog(raw);
      if (!parsed) continue;
      if (parsed.name === "QuoteSelected" || parsed.name === "SwapQualityRecorded") {
        console.log(`\n${parsed.name}:`);
        console.log(parsed.args);
      }
    } catch {
      // Ignore non-hook logs.
    }
  }

  const s1 = await registry.agentStats(agent1.address);
  const s2 = await registry.agentStats(agent2.address);
  const r1 = await registry.getAgentWinRateBps(agent1.address);
  const r2 = await registry.getAgentWinRateBps(agent2.address);

  console.log("\nAgent stats:");
  console.log({ agent: agent1.address, submissions: s1.submissions.toString(), wins: s1.wins.toString(), winRateBps: r1.toString() });
  console.log({ agent: agent2.address, submissions: s2.submissions.toString(), wins: s2.wins.toString(), winRateBps: r2.toString() });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
