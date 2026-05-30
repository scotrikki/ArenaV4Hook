# Execution Quality Market

ArenaV4Hook is evolving from an AI Agent RFQ arena into a verifiable execution-quality market for Uniswap v4 swaps.

The current testnet demo keeps settlement simple, but turns every proof file into a product-level evidence layer: execution surplus, order routing intelligence, and Agent performance reputation.

## Product Thesis

Traditional RFQ systems rely on opaque relationships with a small number of market makers. Arena uses v4 hooks and signed Agent quotes to make execution quality measurable:

- users can compare the baseline pool output with the selected Agent quote;
- Agents build a public performance record through submissions, wins, latency, and positive improvement;
- enterprise reviewers can inspect the exact transaction, hook events, and generated report;
- the product can stay free during ecosystem growth while still proving Agent value.

## Current Reporter Layer

`npm run demo:report` reads a deployment proof JSON and presents the latest execution as four review surfaces.

### Surplus Lens

Surplus Lens reframes `finalAmountOut - baselineAmountOut` as user-visible value:

- `estimatedUserSurplus`
- `surplusRatio`
- `competitivePressure`
- human-readable interpretation

This borrows the surplus language used by solver and auction systems without introducing production fee sharing yet.

### Order Intelligence

Order Intelligence classifies how the swap behaved:

- `small` / `mid` / `large` / `auction-eligible`
- `direct-settle` / `light-agent-auction` / `full-agent-auction` / `fallback`
- rationale based on `swapAmountIn`, `directSettleThreshold`, `quoteCount`, and `usedFallback`

The current implementation is reporter-level. A future contract iteration can emit explicit `OrderSizeClassified` and `RoutingDecision` events.

### Agent Performance Passport

Agent Performance Passport turns raw stats into a compact Agent reputation profile:

- `style`
- `winRate`
- `avgPositiveImprove`
- `acceptanceRate`
- `latencyProfile`
- `reliabilitySignal`

The first version is intentionally derived from existing events and proof files, so it adds investor-demo value without increasing contract risk.

### Investor Summary

The final report section compresses the proof into one line: product claim, measured improvement, and the next innovation frontier.

## Near-Term Implementation Path

1. Expand `npm run agents:leaderboard` into a persisted multi-proof leaderboard for dashboards.
2. Emit order-size and routing-decision events from `ArenaV4Hook`.
3. Add Agent capability attestations in `AgentQuoteRegistry`.
4. Upgrade quote signing to EIP-712 typed data.
5. Add privacy-aware quote flow design for large orders.

## Not In Scope Yet

- Real fee sharing or Agent reward settlement.
- Agent slashing and bonded participation.
- Cross-chain atomic quotes.
- CoW-style batch auctions inside the current single-swap hook lifecycle.

Those ideas remain valid long-term directions, but the current product should stay focused on a reproducible, transparent, testnet-grade execution-quality demo.