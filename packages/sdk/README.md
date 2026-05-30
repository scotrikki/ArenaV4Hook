# ArenaV4Hook SDK

This package is a lightweight integration helper for the current JavaScript/Hardhat workspace. It mirrors the demo contract encoding exactly so routers and Agents can build hook data and quote signatures without hand-writing ABI encoding.

## Current Scope

- Compute `requestId` with the same `abi.encode` layout as `ArenaV4Hook.computeRequestIdWithSalt`.
- Compute the current ERC-191 demo quote digest with the same packed layout as `ArenaV4Hook.quoteMessageHash`.
- Sign Agent quotes with an ethers signer.
- Encode and decode the `HookQuoteData` tuple used by `beforeSwap`.

## Example

```js
const { ethers } = require("ethers");
const {
  computeRequestId,
  encodeHookData,
  signQuote
} = require("./packages/sdk");

const requestId = computeRequestId({
  sender: user,
  amountIn: 5000n,
  tokenIn,
  tokenOut,
  zeroForOne: true,
  requestSalt: ethers.id("enterprise-demo")
});

const signature = await signQuote({
  signer: agentSigner,
  hook,
  chainId: 1952n,
  requestId,
  amountOut: 5200n,
  validUntil,
  nonce: 0n
});

const hookData = encodeHookData({
  user,
  agent,
  amountOut: 5200n,
  minAmountOut: 4500n,
  quoteDeadline,
  validUntil,
  nonce: 0n,
  requestSalt,
  signature
});
```

## Production Note

The current signing helper intentionally matches the demo contract. Production integrations should move to the EIP-712 flow described in `docs/production-readiness-roadmap.md` before mainnet value.
