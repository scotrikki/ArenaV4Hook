# Enterprise Architecture

ArenaV4Hook should be presented as a hybrid product: an open Uniswap v4 hook protocol, an Agent quote network, and an enterprise control plane that turns hook events into reliable execution-quality evidence.

The current repository proves the protocol and reporting core on local v4 and xLayer testnet. The enterprise version adds data, API, monitoring, governance, and operator workflows around the hook without pretending the demo contracts are mainnet-ready today.

## Product Shape

| Layer | Purpose | Current status |
| --- | --- | --- |
| Hook protocol | Opens swap-scoped quote requests, accepts signed Agent quotes, selects best execution, emits quality events | Implemented in `ArenaV4Hook.sol` |
| Agent registry | Controls Agent admission and records submissions, wins, and positive improvement | Implemented in `AgentQuoteRegistry.sol` |
| Proof reporter | Turns deployment JSON and hook events into enterprise-readable evidence | Implemented in `scripts/demo-report.js` |
| Indexer | Reads hook events into queryable execution records | Designed, not built |
| API | Exposes agents, requests, quotes, settlements, and status to integrators | Local proof-file prototype in `packages/api` |
| Dashboard | Gives operators a live view of requests, fallback rate, Agent health, and incidents | Designed, not built |
| SDK | Helps routers and Agents encode hook data and sign quotes safely | Initial JavaScript helper in `packages/sdk` |
| Governance and monitoring | Safe ownership, timelock, pause, alerts, runbooks, and audit trail | Roadmapped |

## Reference System

```text
Router / App / Enterprise Client
        |
        v
Integration SDK  ---- Agent Quote Gateway ---- Whitelisted Agents
        |                    |
        v                    v
Uniswap v4 PoolManager + ArenaV4Hook + AgentQuoteRegistry
        |
        v
Hook Events: QuoteWindowOpened, QuoteSubmitted, QuoteRejected,
QuoteSelected, SwapQualityRecorded
        |
        v
Indexer / Subgraph / Event Worker
        |
        +---- REST and WebSocket API
        +---- Enterprise Dashboard
        +---- Monitoring and Alerting
        +---- Proof Reporter and Investor Reports
```

## Request Lifecycle

1. A router or custom periphery builds hook data with user, min output, quote deadline, request salt, and optionally one inline Agent quote.
2. `beforeSwap` opens a deterministic request and records the quote window.
3. Approved Agents compete with signed quotes. The current demo supports inline quote submission and external `submitQuote` for split-phase flows.
4. The hook keeps the best usable `amountOut` and emits non-reverting rejection events for invalid quotes.
5. `afterSwap` settles the request once, records fallback or selected quote outcome, and emits `SwapQualityRecorded`.
6. The indexer converts events into `Request`, `Quote`, `Settlement`, and `AgentPassport` records.
7. The API, dashboard, and reporter expose objective execution-quality evidence to users, integrators, and enterprise reviewers.

## Enterprise Data Model

| Entity | Key fields |
| --- | --- |
| Agent | address, whitelist status, supported pairs, max order size, risk tier, submissions, wins, win rate |
| Request | requestId, sender, tokenIn, tokenOut, amountIn, minAmountOut, quoteDeadline, openedAt, status |
| Quote | requestId, agent, amountOut, validUntil, nonce, accepted, rejectionReason, observedAt |
| Settlement | requestId, selectedAgent, baselineAmountOut, finalAmountOut, improvementBps, quoteCount, latencySeconds, usedFallback |
| AgentPassport | agent, style, average improvement, acceptance rate, reliability signal, last active block |
| Alert | severity, rule, requestId, agent, threshold, observed value, status, acknowledgedBy |

## Environment Strategy

| Environment | Goal | Exit criteria |
| --- | --- | --- |
| Local hardhat | Developer verification | `npm test`, `npm run v4:local-flow`, event assertions pass |
| xLayer testnet | Enterprise demo and investor proof | Latest deployment proof, reporter output, explorer links, security notes |
| Private beta | Selected routers and Agents | EIP-712, Safe ownership, pause, indexer, monitoring, incident drill |
| Production candidate | Mainnet readiness review | External audit, fuzz/gas suite, timelock, SLA, runbooks, legal review |

## Build Sequence

1. Keep the current demo stable and reproducible.
2. Add enterprise artifacts: architecture, API contract, monitoring runbook, readiness report.
3. Add SDK helpers for request IDs, hook data encoding, and demo quote signing.
4. Build an event indexer and read-only API before adding new settlement economics.
5. Move governance to Safe, introduce pause controls, and upgrade signatures to EIP-712.
6. Run fuzz tests, gas snapshots, incident drills, and an external audit before mainnet value.

## Architectural Guardrails

- Do not route production value through the current no-op hook address validation build.
- Do not market the current signature scheme as production-grade typed signing.
- Keep the first enterprise API read-heavy; write operations should remain on-chain or go through explicitly governed relayers.
- Keep Agent reputation transparent and event-derived before introducing fees, bonds, or slashing.
- Treat the dashboard as an operator surface, not a source of truth. The chain and indexer records remain authoritative.
