const { expect } = require("chai");
const { ethers } = require("hardhat");

const {
  computeRequestId,
  decodeHookData,
  encodeHookData,
  quoteMessageHash,
  signQuote
} = require("../packages/sdk");

describe("ArenaV4Hook SDK", function () {
  async function deployFixture() {
    const [owner, user, agent] = await ethers.getSigners();

    const AgentQuoteRegistry = await ethers.getContractFactory("AgentQuoteRegistry");
    const registry = await AgentQuoteRegistry.deploy(owner.address);
    await registry.waitForDeployment();

    await registry.connect(owner).setAgentWhitelist(agent.address, true);

    const PoolManagerCallerMock = await ethers.getContractFactory("PoolManagerCallerMock");
    const manager = await PoolManagerCallerMock.deploy();
    await manager.waitForDeployment();

    const ArenaV4Hook = await ethers.getContractFactory("ArenaV4Hook");
    const hook = await ArenaV4Hook.deploy(await manager.getAddress(), await registry.getAddress(), 1000n);
    await hook.waitForDeployment();

    await registry.connect(owner).setHook(await hook.getAddress());

    return { hook, user, agent };
  }

  it("matches the contract request id and quote digest", async function () {
    const { hook, user } = await deployFixture();
    const tokenIn = "0x0000000000000000000000000000000000000001";
    const tokenOut = "0x0000000000000000000000000000000000000002";
    const requestSalt = ethers.id("sdk-request");
    const amountIn = 5000n;
    const requestId = computeRequestId({
      sender: user.address,
      amountIn,
      tokenIn,
      tokenOut,
      zeroForOne: true,
      requestSalt
    });

    expect(requestId).to.equal(
      await hook.computeRequestIdWithSalt(user.address, amountIn, tokenIn, tokenOut, true, requestSalt)
    );

    const chainId = (await ethers.provider.getNetwork()).chainId;
    const digest = quoteMessageHash({
      hook: await hook.getAddress(),
      chainId,
      requestId,
      amountOut: 5200n,
      validUntil: 123456n,
      nonce: 0n
    });

    expect(digest).to.equal(await hook.quoteMessageHash(requestId, 5200n, 123456n, 0n));
  });

  it("encodes hook data that the contract can decode", async function () {
    const { hook, user, agent } = await deployFixture();
    const requestSalt = ethers.id("sdk-hook-data");
    const requestId = computeRequestId({
      sender: user.address,
      amountIn: 5000n,
      tokenIn: "0x0000000000000000000000000000000000000001",
      tokenOut: "0x0000000000000000000000000000000000000002",
      zeroForOne: true,
      requestSalt
    });
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const validUntil = 123456n;
    const signature = await signQuote({
      signer: agent,
      hook: await hook.getAddress(),
      chainId,
      requestId,
      amountOut: 5200n,
      validUntil,
      nonce: 0n
    });
    const encoded = encodeHookData({
      user: user.address,
      agent: agent.address,
      amountOut: 5200n,
      minAmountOut: 4500n,
      quoteDeadline: 123500n,
      validUntil,
      nonce: 0n,
      requestSalt,
      signature
    });
    const decodedByContract = await hook.decodeHookData(encoded);
    const decodedBySdk = decodeHookData(encoded);

    expect(decodedByContract.user).to.equal(user.address);
    expect(decodedByContract.agent).to.equal(agent.address);
    expect(decodedByContract.amountOut).to.equal(5200n);
    expect(decodedByContract.minAmountOut).to.equal(4500n);
    expect(decodedByContract.quoteDeadline).to.equal(123500n);
    expect(decodedByContract.validUntil).to.equal(validUntil);
    expect(decodedByContract.nonce).to.equal(0n);
    expect(decodedByContract.requestSalt).to.equal(requestSalt);
    expect(decodedByContract.signature).to.equal(signature);
    expect(decodedBySdk.signature).to.equal(signature);
  });
});
