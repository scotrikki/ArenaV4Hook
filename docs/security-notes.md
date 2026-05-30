# ArenaV4Hook Security Notes

This document captures the current security posture of the ArenaV4Hook testnet demo. It is meant for investor demos and enterprise technical review, not as a substitute for an external audit.

## Current Scope

ArenaV4Hook is a Uniswap v4 hook demo that opens a swap-scoped quote request, accepts signed quotes from whitelisted agents, selects the highest usable `amountOut`, and emits measurable execution quality events.

The current deployment target is an enterprise-grade testnet demo. It is not presented as production-ready mainnet infrastructure.

## Protected Paths

- Agent admission is controlled by `AgentQuoteRegistry.setAgentWhitelist`.
- Only the configured hook can mutate registry submission and win statistics.
- Agent quotes are signed and recovered against `address(this)`, `block.chainid`, `requestId`, `amountOut`, `validUntil`, and per-agent `nonce`.
- Per-agent nonces prevent replay after a quote has been accepted.
- `requestSalt` separates repeated swaps with identical sender, token pair, direction, and amount.
- Expired quote windows and expired quotes are rejected.
- Invalid quote submissions are non-reverting and emit `QuoteRejected`, keeping the swap fallback path observable.
- Settlement is single-use through the `settled` flag.
- If no usable quote exists, settlement falls back to the baseline v4 swap output and emits `usedFallback = true`.

## Known Demo Limitations

- `ArenaV4Hook.validateHookAddress` is intentionally overridden as a no-op for local and testnet demo deployment. Production deployment must use a mined hook address and the default Uniswap v4 permission validation.
- The owner account currently controls the registry, hook binding, and agent whitelist. Production should move these powers to a multisig with a documented emergency process.
- There is no pause switch yet. Production should add an emergency stop for quote acceptance and sensitive registry operations.
- There is no slashing, bond, or fee settlement model for agents. The current product decision is to keep the testnet demo free and use reputation statistics first.
- The external `submitQuote` entry point is intended for split-phase demo flows and future custom periphery flows. Standard v4 swap callbacks execute within one transaction, so production routing must explicitly define whether competition happens off-chain before swap submission or through a custom executor.
- Quote signatures use an Ethereum signed message digest rather than a full EIP-712 typed-data domain. EIP-712 should be introduced before production integrations.
- The contracts have not been externally audited.

## Production Readiness Checklist

- Replace the local/dev `validateHookAddress` override with standard hook permission validation and HookMiner-based deployment.
- Add multisig ownership, owner transfer flow, and optional timelock for non-emergency changes.
- Add pausable controls for quote intake and registry administration.
- Define the production quote lifecycle: off-chain RFQ before swap, split-phase custom executor, or another explicit architecture.
- Upgrade signatures to EIP-712 typed data and publish the exact signing schema.
- Add fuzz tests for nonce handling, quote expiry, duplicate request salts, zero/negative deltas, and high-value boundary cases.
- Add gas snapshots for the main hook paths.
- Add monitoring for `QuoteRejected`, high fallback rate, abnormal latency, and agent win-rate anomalies.
- Complete at least one external audit before any mainnet deployment that handles material value.

## Demo Review Commands

```bash
npm test
npm run v4:local-flow
npm run verify:v4:xlayer-testnet
```

Expected demo evidence includes `QuoteWindowOpened`, one or more `QuoteSubmitted`, `QuoteSelected`, and `SwapQualityRecorded` with explicit `improvementBps`, `quoteCount`, `latencySeconds`, and `usedFallback` values.