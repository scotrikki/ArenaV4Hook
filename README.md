# ArenaV4Hook

ArenaV4Hook is a Uniswap v4 hook demo that turns a swap into an AI Agent RFQ arena. A swap-scoped quote request is opened, whitelisted agents submit signed quotes, the hook selects the best usable `amountOut`, and the chain records measurable execution quality: price improvement, quote count, latency, fallback status, and agent reputation.

The next product layer is a verifiable Agent execution-quality market: every accepted quote, selected winner, fallback, latency signal, and price improvement becomes part of an Agent Performance Passport.

The current product target is an enterprise-grade testnet demo for fundraising and technical evaluation. It is not production-ready mainnet infrastructure yet.

## Why it exists

Large swaps can lose value through slippage, stale routing, and opaque execution quality. ArenaV4Hook makes execution quality competitive and auditable by letting agents compete on price improvement while the hook emits objective metrics for every settled request.

Core evaluation metrics:

- `baselineAmountOut`
- `finalAmountOut`
- `improvementBps`
- `quoteCount`
- `latencySeconds`
- `usedFallback`
- per-agent submissions, wins, and positive improvement
- estimated user surplus (`finalAmountOut - baselineAmountOut`)
- order size class and routing mode
- Agent Performance Passport signals

## Architecture

1. A user or periphery flow starts a v4 swap with Arena hook data.
2. `ArenaV4Hook.beforeSwap` opens a request and can accept an inline signed quote.
3. Additional signed quotes can be submitted to an open request through `ArenaV4Hook.submitQuote` for split-phase demo and custom periphery flows.
4. The hook stores the highest usable `amountOut` as the current best quote.
5. `ArenaV4Hook.afterSwap` settles once, falls back if no usable quote exists, records registry stats, and emits quality metrics.
6. `scripts/demo-report.js` turns those proof files into a Surplus Lens, Order Intelligence, and Agent Performance Passport for investor and enterprise review.

## Implemented features

- `AgentQuoteRegistry.sol`
  - owner-managed whitelist
  - hook binding (`setHook`)
  - per-agent stats (`submissions`, `wins`, `cumulativePositiveImprovementBps`)
- `ArenaHook.sol`
  - quote window opening
  - signature-based quote submission (`submitQuote(requestId, agent, amountOut, validUntil, nonce, signature)`)
  - best quote selection by highest `amountOut`
  - fallback logic for:
    - missing/expired quotes
    - small trades under `directSettleThreshold`
  - single-settlement protection
  - metrics-rich quality event:
    - `improvementBps`
    - `quoteCount`
    - `latencySeconds`
    - `usedFallback`
- `ArenaV4Hook.sol` (Uniswap v4 native hook form)
  - inherits `BaseHook`
  - enables `beforeSwap` + `afterSwap` permissions
  - hookData-driven quote submission (signature + nonce validation)
  - external `submitQuote` intake for multiple signed agent quotes on an open request
  - fallback settlement and quality metrics in `afterSwap`
  - temporary `validateHookAddress` no-op for local/dev tests (production should deploy with HookMiner)
- Real v4 local flow (Step 2)
  - deploys real `PoolManager` + ERC20 tokens
  - mines CREATE2 salt so hook low 14 bits match `beforeSwap/afterSwap` flags (`0xC0`)
  - initializes pool, adds liquidity, executes real swap via unlock callback
  - emits and validates `QuoteWindowOpened/QuoteSubmitted/QuoteSelected/SwapQualityRecorded`
- focused test suite for quote validation, fallback, request isolation, and multi-agent selection
- local deployment script for full wiring (`Registry -> Hook -> whitelist`)
- demo reporter that shows deployment evidence, surplus, order routing mode, and Agent Performance Passport

## Current enterprise status

| Area | Status |
| --- | --- |
| Core v4 hook demo | Working locally and on xLayer testnet |
| Agent signature validation | Implemented with nonce replay protection |
| Multi-agent quote selection | Covered by tests through `submitQuote` |
| Surplus Lens | Implemented in `npm run demo:report` |
| Agent Performance Passport | Implemented as a proof-file reporter layer |
| Enterprise API prototype | Implemented as a local read-only proof-file API |
| Fallback observability | Implemented through `SwapQualityRecorded` |
| Production hook address validation | Not enabled in demo build; see security notes |
| Multisig, pause, timelock | Planned, not implemented |
| External audit | Not completed |

See `docs/security-notes.md` before presenting this as anything beyond a testnet demo.

For the product innovation layer, see `docs/execution-quality-market.md`.

For the enterprise application plan, see `docs/enterprise-architecture.md`, `docs/production-readiness-roadmap.md`, `docs/api-reference.md`, and `docs/monitoring-runbook.md`.

## Project structure

- `contracts/AgentQuoteRegistry.sol` - whitelist + stats registry
- `contracts/ArenaHook.sol` - RFQ arena hook core logic
- `contracts/ArenaV4Hook.sol` - v4-native BaseHook implementation
- `contracts/PoolManagerCallerMock.sol` - test-only pool manager caller mock
- `contracts/v4/V4PoolManager.sol` - deployable wrapper for v4 `PoolManager`
- `contracts/v4/V4FlowExecutor.sol` - unlock-callback executor for modifyLiquidity/swap settlement
- `contracts/v4/TestERC20Mintable.sol` - simple mintable token for local v4 flow
- `contracts/v4/DeterministicCreate2Factory.sol` - local CREATE2 deploy helper for mined hook address
- `test/ArenaHook.t.js` - full feature tests
- `test/ArenaV4Hook.t.js` - v4 hook tests
- `scripts/deploy-arena-hook.js` - full deployment and setup
- `scripts/v4-local-flow.js` - one-command real v4 local pipeline demo
- `scripts/demo-report.js` - proof-file execution-quality reporter
- `scripts/agent-leaderboard.js` - multi-proof Agent leaderboard reporter
- `scripts/enterprise-readiness.js` - enterprise demo readiness and production blocker report
- `scripts/migrate-proofs.js` - upgrades legacy proof JSON to the unified `arena-proof-v1` schema
- `packages/api/` - local read-only enterprise API prototype backed by proof files
- `packages/sdk/` - JavaScript helpers for request IDs, quote signatures, and hookData encoding
- `hardhat.config.js` - Hardhat config

## Prerequisites

- Node.js v20+
- npm

## Install

```bash
npm install
```

## Run tests

```bash
npx hardhat test
```

Expected result: all tests passing.

## Run real v4 local flow (Step 2)

```bash
npm run v4:local-flow
```

This will:

1. deploy `V4PoolManager`, two test tokens, registry, CREATE2 factory, hook, and flow executor
2. mine a hook deployment salt so hook address low bits = `0xC0` (`beforeSwap + afterSwap`)
3. initialize pool + add liquidity + run real swap
4. print transaction hashes and hook event results
5. write JSON proof under `deployments/v4-local-flow-*.json`

## Enterprise demo path

For a technical evaluation or investor demo, use this order:

1. Run `npm test` to prove quote validation, fallback behavior, request isolation, and multi-agent selection.
2. Run `npm run v4:local-flow` to prove the real v4 local pipeline with hook events.
3. Run `npm run demo:report` to print the latest deployment addresses, transactions, Surplus Lens, Order Intelligence, and Agent Performance Passport.
4. Run `npm run agents:leaderboard` to aggregate proof files into an Agent leaderboard.
5. Run `npm run enterprise:check` to print testnet demo readiness and remaining production blockers.
6. Open `deployments/v4-xlayerTestnet-latest.json` and the latest `submissions/submission-v4-xlayerTestnet-*.md` to show xLayer testnet evidence.
7. Review `docs/security-notes.md` and `docs/production-readiness-roadmap.md` to clearly separate demo guarantees from production readiness work.

To report a specific proof file:

```bash
DEPLOYMENT_FILE=deployments/v4-local-flow-....json npm run demo:report
```

On PowerShell:

```powershell
$env:DEPLOYMENT_FILE="deployments/v4-local-flow-....json"; npm run demo:report; Remove-Item Env:DEPLOYMENT_FILE
```

To print the current enterprise readiness posture:

```bash
npm run enterprise:check
```

This command is intentionally honest: it can mark the testnet enterprise demo as ready while still reporting mainnet production as blocked until governance, EIP-712, pause controls, monitoring, and audit work are complete.

To aggregate proof files into an Agent leaderboard:

```bash
npm run agents:leaderboard
```

To upgrade legacy proof files to the unified proof schema:

```bash
npm run proofs:migrate
```

For integration helpers, see `packages/sdk/README.md`.

To start the local read-only API prototype:

```bash
npm run api:dev
```

Then open `http://localhost:8787/v1/hook/status` or `http://localhost:8787/v1/quality/summary`.

## Deploy real v4 flow to X Layer Testnet (Step 3)

```bash
npm run deploy:v4:xlayer-testnet
```

This will:

1. deploy `V4PoolManager`, `AgentQuoteRegistry`, `DeterministicCreate2Factory`, `ArenaV4Hook`, `V4FlowExecutor`, and 2 test tokens
2. mine CREATE2 salt to make hook address low 14 bits equal `0xC0`
3. run real `initialize -> addLiquidity -> swap`
4. assert hook events on swap tx
5. write deployment proof JSON to:
   - `deployments/v4-xlayerTestnet-<chainId>-<timestamp>.json`
   - `deployments/v4-xlayerTestnet-latest.json`

Optional env tuning:

- `V4_TOKEN_MINT_AMOUNT`
- `V4_DIRECT_SETTLE_THRESHOLD`
- `V4_POOL_FEE`
- `V4_TICK_SPACING`
- `V4_INIT_SQRT_PRICE_X96`
- `V4_LIQUIDITY_DELTA`
- `V4_TICK_LOWER`
- `V4_TICK_UPPER`
- `V4_SWAP_AMOUNT_IN`
- `V4_QUOTED_AMOUNT_OUT`
- `V4_MIN_AMOUNT_OUT`
- `V4_QUOTE_WINDOW_SEC`
- `V4_QUOTE_VALID_SEC`
- `V4_QUOTE_AGENT`
- `HOOK_SALT_MAX_TRIES`

## Verify Step 3 contracts

```bash
npm run verify:v4:xlayer-testnet
```

By default this reads:

- `deployments/v4-xlayerTestnet-latest.json`

If you want a specific file:

```bash
DEPLOYMENT_FILE=deployments/v4-xlayerTestnet-....json npm run verify:v4:xlayer-testnet
```

## Generate Step 3 submission draft

```bash
npm run submission:v4:xlayer-testnet
```

Output:

- `submissions/submission-v4-xlayerTestnet-<timestamp>.md`

## Deploy locally

In terminal 1:

```bash
npx hardhat node
```

In terminal 2:

```bash
npx hardhat run scripts/deploy-arena-hook.js --network localhost
```

## Auto deploy to X Layer / X Layer Testnet

1. Create env file:

```bash
cp .env.example .env
```

2. Fill `.env`:

- `DEPLOYER_PRIVATE_KEY` (without `0x`)
- `XLAYER_TESTNET_RPC_URL`
- `XLAYER_MAINNET_RPC_URL`
- Optional `WHITELIST_AGENTS` as comma-separated addresses
- Optional `AUTO_VERIFY=true` to try source verification after deployment

3. Deploy:

```bash
# Testnet
npm run deploy:xlayer-testnet

# Mainnet
npm run deploy:xlayer
```

Deployment script output includes:

- `registryAddress`
- `hookAddress`
- `directSettleThreshold`
- whitelisted agents

It also writes deployment artifacts to:

- `deployments/<network>-<chainId>-<timestamp>.json`
- `deployments/<network>-latest.json`

## Verify deployed contracts (with retry)

```bash
# Testnet
npm run verify:xlayer-testnet

# Mainnet
npm run verify:xlayer
```

The verify script reads `deployments/<network>-latest.json` by default and retries verification automatically.

## Generate submission draft automatically

```bash
# Testnet
npm run submission:xlayer-testnet

# Mainnet
npm run submission:xlayer
```

This generates a markdown draft under `submissions/` with:

- deployed addresses
- constructor arguments
- explorer links
- submit checklist

## What requires your manual action

For real on-chain deployment, you must do these steps locally:

1. Fill `.env` with:
   - `DEPLOYER_PRIVATE_KEY`
   - `XLAYER_TESTNET_RPC_URL` / `XLAYER_MAINNET_RPC_URL`
2. Fund deployer wallet with gas token.
3. Run:
   - `npm run deploy:xlayer-testnet`
   - `npm run verify:xlayer-testnet`
   - `npm run submission:xlayer-testnet`

I can generate all scripts and docs, but private key custody and final on-chain transaction signing must remain on your side.

## Run end-to-end demo flow

```bash
npm run demo
```

This script deploys registry + hook, submits signed quotes from two agents, settles one request, and prints:

- `QuoteSelected`
- `SwapQualityRecorded`
- per-agent stats and win rate bps

## Next coding steps

1. Add a multi-proof Agent leaderboard that aggregates several `v4-local-flow-*` and xLayer deployment files.
2. Add order-size adaptive events in `ArenaV4Hook` so small/mid/large routing decisions are explicit on-chain.
3. Add Agent capability attestations for supported pairs, max order size, risk level, and expiry.
4. Add EIP-712 typed quote signing and a TypeScript helper for agents.
5. Add pausable controls and multisig handoff guidance for the registry and hook owner operations.
6. Add gas snapshots and fuzz tests for nonce, expiry, fallback, and repeated request salt boundaries.
7. Add an explicit production quote lifecycle design before any mainnet deployment.
