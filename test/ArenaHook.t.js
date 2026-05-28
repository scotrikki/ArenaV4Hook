const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("ArenaHook (full feature)", function () {
  async function deployFixture() {
    const [owner, user, agent1, agent2, agent3, outsider] = await ethers.getSigners();

    const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
    const registry = await AgentQuoteRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    await registry.connect(owner).setAgentWhitelist(agent1.address, true);
    await registry.connect(owner).setAgentWhitelist(agent2.address, true);
    await registry.connect(owner).setAgentWhitelist(agent3.address, true);

    const ArenaHook = await ethers.getContractFactory("ArenaHook");
    const hook = await ArenaHook.deploy(await registry.getAddress(), 1000n);
    await hook.waitForDeployment();
    await registry.connect(owner).setHook(await hook.getAddress());

    return { hook, registry, owner, user, agent1, agent2, agent3, outsider };
  }

  async function openRequest(hook, user, amountIn = 5000n, window = 60) {
    const tx = await hook.connect(user).openQuoteWindow(ethers.ZeroAddress, ethers.ZeroAddress, amountIn, 4500n, window);
    const receipt = await tx.wait();
    const requestId = await hook.computeRequestId(user.address, receipt.blockNumber, amountIn);
    return { tx, receipt, requestId };
  }

  async function buildQuoteMessage(hook, chainId, requestId, amountOut, validUntil, nonce) {
    return ethers.solidityPackedKeccak256(
      ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
      [await hook.getAddress(), chainId, requestId, amountOut, validUntil, nonce]
    );
  }

  async function signQuote(agent, digestHex) {
    return agent.signMessage(ethers.getBytes(digestHex));
  }

  it("emits QuoteWindowOpened and computes deterministic requestId", async function () {
    const { hook, user } = await deployFixture();
    const { tx, receipt, requestId } = await openRequest(hook, user, 5000n, 60);
    const block = await ethers.provider.getBlock(receipt.blockNumber);

    await expect(tx)
      .to.emit(hook, "QuoteWindowOpened")
      .withArgs(requestId, user.address, ethers.ZeroAddress, ethers.ZeroAddress, 5000n, block.timestamp + 60);
  });

  it("accepts signature-based quotes from whitelisted agents only", async function () {
    const { hook, user, agent1, outsider } = await deployFixture();
    const { requestId } = await openRequest(hook, user, 5000n, 60);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const validUntil = now + 30;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const digest = await buildQuoteMessage(hook, chainId, requestId, 5100n, validUntil, 0n);
    const sig1 = await signQuote(agent1, digest);

    await expect(hook.connect(user).submitQuote(requestId, agent1.address, 5100n, validUntil, 0n, sig1))
      .to.emit(hook, "QuoteSubmitted")
      .withArgs(requestId, agent1.address, 5100n, validUntil);

    const outsiderSig = await signQuote(outsider, digest);
    await expect(
      hook.connect(user).submitQuote(requestId, outsider.address, 5200n, validUntil, 0n, outsiderSig)
    ).to.be.revertedWith("ArenaHook: agent not whitelisted");
  });

  it("rejects quotes with invalid signer and expired validity", async function () {
    const { hook, user, agent1, agent2 } = await deployFixture();
    const { requestId } = await openRequest(hook, user, 5000n, 60);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const digest = await buildQuoteMessage(hook, chainId, requestId, 5150n, now + 20, 0n);
    const wrongSig = await signQuote(agent2, digest);

    await expect(
      hook.connect(user).submitQuote(requestId, agent1.address, 5150n, now + 20, 0n, wrongSig)
    ).to.be.revertedWith("ArenaHook: invalid signature");

    const expiredDigest = await buildQuoteMessage(hook, chainId, requestId, 5150n, now - 1, 0n);
    const expiredSig = await signQuote(agent1, expiredDigest);

    await expect(
      hook.connect(user).submitQuote(requestId, agent1.address, 5150n, now - 1, 0n, expiredSig)
    ).to.be.revertedWith("ArenaHook: quote expired");
  });

  it("selects best quote and records detailed quality metrics", async function () {
    const { hook, registry, user, agent1, agent2 } = await deployFixture();
    const { requestId, receipt } = await openRequest(hook, user, 5000n, 60);

    const openBlock = await ethers.provider.getBlock(receipt.blockNumber);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const d1 = await buildQuoteMessage(hook, chainId, requestId, 5100n, now + 30, 0n);
    const d2 = await buildQuoteMessage(hook, chainId, requestId, 5200n, now + 30, 0n);

    await hook.connect(user).submitQuote(requestId, agent1.address, 5100n, now + 30, 0n, await signQuote(agent1, d1));
    await hook.connect(user).submitQuote(requestId, agent2.address, 5200n, now + 30, 0n, await signQuote(agent2, d2));

    const settleTx = await hook.connect(user).settleRequest(requestId, 5000n, 130000n);
    const settleReceipt = await settleTx.wait();
    const settleBlock = await ethers.provider.getBlock(settleReceipt.blockNumber);

    await expect(settleTx).to.emit(hook, "QuoteSelected").withArgs(requestId, agent2.address, 5200n);

    await expect(settleTx)
      .to.emit(hook, "SwapQualityRecorded")
      .withArgs(
        requestId,
        5000n,
        5200n,
        400n,
        130000n,
        2n,
        settleBlock.timestamp - openBlock.timestamp,
        false
      );

    const request = await hook.requests(requestId);
    expect(request.settled).to.equal(true);

    const stats = await registry.agentStats(agent2.address);
    expect(stats.wins).to.equal(1n);
    expect(stats.submissions).to.equal(1n);
    expect(await registry.getAgentWinRateBps(agent2.address)).to.equal(10000n);
  });

  it("falls back when no valid quote is available and marks fallback", async function () {
    const { hook, user } = await deployFixture();
    const { requestId } = await openRequest(hook, user, 5000n, 1);

    await ethers.provider.send("evm_increaseTime", [3]);
    await ethers.provider.send("evm_mine", []);

    const settleTx = await hook.connect(user).settleRequest(requestId, 4950n, 110000n);

    await expect(settleTx).to.emit(hook, "QuoteSelected").withArgs(requestId, ethers.ZeroAddress, 4950n);

    await expect(settleTx)
      .to.emit(hook, "SwapQualityRecorded")
      .withArgs(requestId, 4950n, 4950n, 0n, 110000n, 0n, 0n, true);
  });

  it("direct-settles small trades under threshold", async function () {
    const { hook, user } = await deployFixture();
    const { requestId } = await openRequest(hook, user, 999n, 60);

    const settleTx = await hook.connect(user).settleRequest(requestId, 995n, 100000n);

    await expect(settleTx).to.emit(hook, "QuoteSelected").withArgs(requestId, ethers.ZeroAddress, 995n);

    await expect(settleTx)
      .to.emit(hook, "SwapQualityRecorded")
      .withArgs(requestId, 995n, 995n, 0n, 100000n, 0n, 0n, true);
  });

  it("prevents duplicate settlement", async function () {
    const { hook, user } = await deployFixture();
    const { requestId } = await openRequest(hook, user, 5000n, 60);

    await hook.connect(user).settleRequest(requestId, 4900n, 100000n);

    await expect(hook.connect(user).settleRequest(requestId, 4900n, 100000n)).to.be.revertedWith(
      "ArenaHook: already settled"
    );
  });

  it("updates registry submission stats across multiple requests", async function () {
    const { hook, registry, user, agent1 } = await deployFixture();
    const chainId = (await ethers.provider.getNetwork()).chainId;

    for (let i = 0; i < 2; i++) {
      const { requestId } = await openRequest(hook, user, 5000n + BigInt(i), 60);
      const now = (await ethers.provider.getBlock("latest")).timestamp;
      const digest = await buildQuoteMessage(hook, chainId, requestId, 5100n + BigInt(i), now + 20, BigInt(i));
      const sig = await signQuote(agent1, digest);

      await hook.connect(user).submitQuote(requestId, agent1.address, 5100n + BigInt(i), now + 20, BigInt(i), sig);
      await hook.connect(user).settleRequest(requestId, 5000n + BigInt(i), 100000n);
    }

    const stats = await registry.agentStats(agent1.address);
    expect(stats.submissions).to.equal(2n);
    expect(stats.wins).to.equal(2n);
    expect(await registry.getAgentWinRateBps(agent1.address)).to.equal(10000n);
  });

  it("rejects reused or out-of-order nonce", async function () {
    const { hook, user, agent1 } = await deployFixture();
    const { requestId } = await openRequest(hook, user, 5000n, 60);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const chainId = (await ethers.provider.getNetwork()).chainId;

    const digest0 = await buildQuoteMessage(hook, chainId, requestId, 5100n, now + 20, 0n);
    const sig0 = await signQuote(agent1, digest0);
    await hook.connect(user).submitQuote(requestId, agent1.address, 5100n, now + 20, 0n, sig0);

    const digestReuse = await buildQuoteMessage(hook, chainId, requestId, 5200n, now + 20, 0n);
    const sigReuse = await signQuote(agent1, digestReuse);
    await expect(
      hook.connect(user).submitQuote(requestId, agent1.address, 5200n, now + 20, 0n, sigReuse)
    ).to.be.revertedWith("ArenaHook: invalid nonce");

    const digestSkip = await buildQuoteMessage(hook, chainId, requestId, 5300n, now + 20, 2n);
    const sigSkip = await signQuote(agent1, digestSkip);
    await expect(
      hook.connect(user).submitQuote(requestId, agent1.address, 5300n, now + 20, 2n, sigSkip)
    ).to.be.revertedWith("ArenaHook: invalid nonce");
  });
});
