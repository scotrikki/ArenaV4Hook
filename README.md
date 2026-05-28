# OKX Hook Hackathon (Agent RFQ Arena Hook - Full Feature)

This repository contains a minimal PoC for the `A: Agent RFQ Arena Hook` direction from:
- `docs/superpowers/specs/2026-05-26-hook-hackathon-ai-agent-directions-design.md`

## Implemented features

- `AgentQuoteRegistry.sol`
  - owner-managed whitelist
  - hook binding (`setHook`)
  - per-agent stats (`submissions`, `wins`, `cumulativePositiveImprovementBps`)
- `ArenaHook.sol`
  - quote window opening
  - signature-based quote submission (`submitQuote(requestId, agent, amountOut, validUntil, signature)`)
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
  - fallback settlement and quality metrics in `afterSwap`
  - temporary `validateHookAddress` no-op for local/dev tests (production should deploy with HookMiner)
- Real v4 local flow (Step 2)
  - deploys real `PoolManager` + ERC20 tokens
  - mines CREATE2 salt so hook low 14 bits match `beforeSwap/afterSwap` flags (`0xC0`)
  - initializes pool, adds liquidity, executes real swap via unlock callback
  - emits and validates `QuoteWindowOpened/QuoteSubmitted/QuoteSelected/SwapQualityRecorded`
- full test suite (12 passing tests)
- local deployment script for full wiring (`Registry -> Hook -> whitelist`)

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

Expected result:

- `12 passing`

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

1. Add replay protection nonce per agent quote (optional hardening)
2. Add minimum bond integration (connect to B-plan fallback/security)
3. Add script that emits sample `QuoteSelected` and `SwapQualityRecorded` events for demo recording
4. Add a lightweight dashboard (or CLI reporter) to display win rate and average improvement
