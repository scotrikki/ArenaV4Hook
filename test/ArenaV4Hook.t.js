const { expect } = require("chai");
const { ethers } = require("hardhat");

const QUOTE_REJECT_INVALID_SIGNATURE = 8n;

describe("ArenaV4Hook", function () {
  async function deployFixture() {
    const [owner, user, agent1, agent2, outsider] = await ethers.getSigners();

    const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
    const registry = await AgentQuoteRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    await registry.connect(owner).setAgentWhitelist(agent1.address, true);
    await registry.connect(owner).setAgentWhitelist(agent2.address, true);

    const PoolManagerCallerMock = await ethers.getContractFactory("PoolManagerCallerMock");
    const manager = await PoolManagerCallerMock.deploy();
    await manager.waitForDeployment();

    const ArenaV4Hook = await ethers.getContractFactory("ArenaV4Hook");
    const hook = await ArenaV4Hook.deploy(await manager.getAddress(), await registry.getAddress(), 1000n);
    await hook.waitForDeployment();

    await registry.connect(owner).setHook(await hook.getAddress());

    return { hook, manager, registry, user, agent1, agent2, outsider };
  }

  function makePoolKey(hookAddress) {
    return {
      currency0: ethers.ZeroAddress,
      currency1: "0x0000000000000000000000000000000000000001",
      fee: 3000,
      tickSpacing: 60,
      hooks: hookAddress
    };
  }

  function makeSwapParams(amountSpecified = -5000n) {
    return {
      zeroForOne: true,
      amountSpecified,
      sqrtPriceLimitX96: 0n
    };
  }

  function buildHookData(payload) {
    return ethers.AbiCoder.defaultAbiCoder().encode(
      [
        "tuple(address user,address agent,uint256 amountOut,uint256 minAmountOut,uint64 quoteDeadline,uint64 validUntil,uint256 nonce,bytes32 requestSalt,bytes signature)"
      ],
      [payload]
    );
  }

  async function signQuote(hook, agent, requestId, amountOut, validUntil, nonce) {
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = ethers.solidityPackedKeccak256(
      ["address", "uint256", "bytes32", "uint256", "uint64", "uint256"],
      [await hook.getAddress(), chainId, requestId, amountOut, validUntil, nonce]
    );
    return agent.signMessage(ethers.getBytes(digest));
  }

  it("returns v4 before/after swap permissions", async function () {
    const { hook } = await deployFixture();

    const perms = await hook.getHookPermissions();
    expect(perms.beforeSwap).to.equal(true);
    expect(perms.afterSwap).to.equal(true);
    expect(perms.beforeSwapReturnDelta).to.equal(false);
    expect(perms.afterSwapReturnDelta).to.equal(false);
  });

  it("records beforeSwap and afterSwap metrics with a valid quote", async function () {
    const { hook, manager, registry, user, agent1 } = await deployFixture();
    const key = makePoolKey(await hook.getAddress());
    const params = makeSwapParams(-5000n);

    const latest = await ethers.provider.getBlock("latest");
    const quoteDeadline = BigInt(latest.timestamp + 60);
    const validUntil = BigInt(latest.timestamp + 30);
    const requestSalt = ethers.keccak256(ethers.toUtf8Bytes("valid-quote-request"));

    const requestId = await hook.computeRequestIdWithSalt(
      user.address,
      5000n,
      key.currency0,
      key.currency1,
      true,
      requestSalt
    );
    const signature = await signQuote(hook, agent1, requestId, 5200n, validUntil, 0n);

    const hookData = buildHookData({
      user: user.address,
      agent: agent1.address,
      amountOut: 5200n,
      minAmountOut: 4500n,
      quoteDeadline,
      validUntil,
      nonce: 0n,
      requestSalt,
      signature
    });

    const beforeTx = await manager.callBeforeSwap(await hook.getAddress(), user.address, key, params, hookData);
    await expect(beforeTx).to.emit(hook, "QuoteWindowOpened");
    await expect(beforeTx).to.emit(hook, "QuoteSubmitted");

    const afterTx = await manager.callAfterSwap(
      await hook.getAddress(),
      user.address,
      key,
      params,
      -5000,
      5000,
      hookData
    );

    await expect(afterTx).to.emit(hook, "QuoteSelected").withArgs(requestId, agent1.address, 5200n);
    await expect(afterTx).to.emit(hook, "SwapQualityRecorded");

    const stats = await registry.agentStats(agent1.address);
    expect(stats.wins).to.equal(1n);
    expect(stats.submissions).to.equal(1n);
  });

  it("falls back when quote signature is invalid", async function () {
    const { hook, manager, user, agent1, outsider } = await deployFixture();
    const key = makePoolKey(await hook.getAddress());
    const params = makeSwapParams(-3000n);

    const latest = await ethers.provider.getBlock("latest");
    const quoteDeadline = BigInt(latest.timestamp + 60);
    const validUntil = BigInt(latest.timestamp + 30);
    const requestSalt = ethers.keccak256(ethers.toUtf8Bytes("invalid-signature-request"));

    const requestId = await hook.computeRequestIdWithSalt(
      user.address,
      3000n,
      key.currency0,
      key.currency1,
      true,
      requestSalt
    );
    const badSignature = await signQuote(hook, outsider, requestId, 3150n, validUntil, 0n);

    const hookData = buildHookData({
      user: user.address,
      agent: agent1.address,
      amountOut: 3150n,
      minAmountOut: 2500n,
      quoteDeadline,
      validUntil,
      nonce: 0n,
      requestSalt,
      signature: badSignature
    });

    const beforeTx = await manager.callBeforeSwap(await hook.getAddress(), user.address, key, params, hookData);
    await expect(beforeTx).to.emit(hook, "QuoteWindowOpened").withArgs(
      requestId,
      user.address,
      key.currency0,
      key.currency1,
      3000n,
      quoteDeadline
    );
    await expect(beforeTx).to.emit(hook, "QuoteRejected").withArgs(
      requestId,
      agent1.address,
      QUOTE_REJECT_INVALID_SIGNATURE,
      0n,
      0n
    );

    const afterTx = await manager.callAfterSwap(await hook.getAddress(), user.address, key, params, -3000, 3000, hookData);
    await expect(afterTx).to.emit(hook, "QuoteSelected").withArgs(requestId, ethers.ZeroAddress, 3000n);
    await expect(afterTx).to.emit(hook, "SwapQualityRecorded").withArgs(
      requestId,
      3000n,
      3000n,
      0n,
      0n,
      0n,
      0n,
      true
    );
  });

  it("keeps repeated swaps isolated when requestSalt differs", async function () {
    const { hook, manager, user } = await deployFixture();
    const key = makePoolKey(await hook.getAddress());
    const params = makeSwapParams(-5000n);

    const latest = await ethers.provider.getBlock("latest");
    const quoteDeadline = BigInt(latest.timestamp + 60);
    const validUntil = BigInt(latest.timestamp + 30);
    const requestSalt1 = ethers.keccak256(ethers.toUtf8Bytes("request-salt-1"));
    const requestSalt2 = ethers.keccak256(ethers.toUtf8Bytes("request-salt-2"));

    const requestId1 = await hook.computeRequestIdWithSalt(
      user.address,
      5000n,
      key.currency0,
      key.currency1,
      true,
      requestSalt1
    );
    const requestId2 = await hook.computeRequestIdWithSalt(
      user.address,
      5000n,
      key.currency0,
      key.currency1,
      true,
      requestSalt2
    );

    expect(requestId1).to.not.equal(requestId2);

    const hookData1 = buildHookData({
      user: user.address,
      agent: ethers.ZeroAddress,
      amountOut: 0n,
      minAmountOut: 4500n,
      quoteDeadline,
      validUntil,
      nonce: 0n,
      requestSalt: requestSalt1,
      signature: "0x"
    });
    const hookData2 = buildHookData({
      user: user.address,
      agent: ethers.ZeroAddress,
      amountOut: 0n,
      minAmountOut: 4600n,
      quoteDeadline,
      validUntil,
      nonce: 0n,
      requestSalt: requestSalt2,
      signature: "0x"
    });

    await manager.callBeforeSwap(await hook.getAddress(), user.address, key, params, hookData1);
    await manager.callBeforeSwap(await hook.getAddress(), user.address, key, params, hookData2);

    const request1 = await hook.requests(requestId1);
    const request2 = await hook.requests(requestId2);

    expect(request1.sender).to.equal(user.address);
    expect(request1.minAmountOut).to.equal(4500n);
    expect(request2.sender).to.equal(user.address);
    expect(request2.minAmountOut).to.equal(4600n);
  });
});
