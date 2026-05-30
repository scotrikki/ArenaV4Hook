# Production Readiness Roadmap

This roadmap separates the current enterprise-grade testnet demo from the work required before any mainnet deployment that handles material value.

## Current Decision

| Target | Decision | Reason |
| --- | --- | --- |
| Local demo | Go | Tests and local v4 flow are reproducible |
| xLayer testnet enterprise demo | Go | Deployment proof, hook events, reporter, and security notes exist |
| Private beta with selected integrators | Conditional | Needs indexer, API, monitoring, Safe ownership, EIP-712, and pause controls |
| Mainnet production | No-go | Hook validation, governance, signatures, monitoring, and audit are not complete |

## Critical Blockers

| Blocker | Current state | Required fix |
| --- | --- | --- |
| Hook address validation | `ArenaV4Hook.validateHookAddress` is a demo no-op | Restore standard permission validation for production builds and deploy through HookMiner |
| Signature format | Quotes use Ethereum signed message digest | Upgrade to EIP-712 typed data and publish signing schema |
| Governance | Owner account controls registry and hook setup | Transfer admin powers to Safe multisig, optionally behind timelock for non-emergency changes |
| Emergency stop | No pause switch | Add pausable quote intake and documented emergency procedures |
| Observability | Reporter exists, live monitoring does not | Add event indexer, alerting, dashboards, and incident runbooks |
| Assurance | Unit tests exist, no audit yet | Add fuzz tests, gas snapshots, invariant tests, and external audit |

## 6-8 Week Implementation Plan

### Week 1: Enterprise Evidence Layer

- Freeze the current xLayer testnet proof as a reproducible evaluation baseline.
- Add enterprise architecture, API reference, monitoring runbook, and readiness report.
- Add multi-proof aggregation for Agent leaderboards.
- Define the first dashboard wireframe around requests, quotes, settlements, and alerts.

### Week 2: Indexer and API

- Build an event worker or subgraph for `QuoteWindowOpened`, `QuoteSubmitted`, `QuoteRejected`, `QuoteSelected`, and `SwapQualityRecorded`.
- Expose read-only endpoints for agents, requests, settlements, hook status, and event streams.
- Add data retention rules and backfill procedure for testnet deployments.

### Week 3: SDK and Agent Integration

- Add TypeScript helpers for request ID computation, hook data encoding, event parsing, and current quote signing.
- Add EIP-712 quote type definitions behind a compatibility flag.
- Publish Agent onboarding flow: whitelist request, supported pairs, max order size, and monitoring expectations.

### Week 4: Governance Hardening

- Add Safe ownership transfer scripts for registry administration.
- Add pausable controls for quote intake and sensitive admin functions.
- Define timelock policy for non-emergency parameter changes.
- Run an emergency pause and unpause drill on testnet.

### Weeks 5-6: Security Testing

- Add fuzz tests for nonce replay, expired quotes, request salt collisions, fallback, zero amounts, and boundary deltas.
- Add gas snapshots for open request, accepted quote, rejected quote, fallback settlement, and selected quote settlement.
- Add static analysis and invariant checks to CI.

### Weeks 7-8: Audit and Beta Readiness

- Complete audit preparation package: architecture, threat model, tests, deployment scripts, and known limitations.
- Run external audit and triage findings.
- Finalize beta SLA, support, incident response, and legal/compliance review.

## Go/No-Go Checklist

### Testnet Enterprise Demo

- [x] Unit tests pass.
- [x] Real v4 local flow runs.
- [x] xLayer testnet deployment proof exists.
- [x] Reporter prints execution quality, surplus, order intelligence, and Agent passport.
- [x] Security notes clearly label demo limitations.

### Private Beta

- [ ] Event indexer or subgraph is deployed.
- [x] Local read-only proof-file API is available with documented schema.
- [ ] Indexed read-only API is available against live chain events.
- [ ] Monitoring alerts are wired to an operator channel.
- [ ] Admin keys are transferred to Safe.
- [ ] Pause procedure has been tested on testnet.
- [ ] EIP-712 signing is implemented or explicitly waived for the beta scope.

### Mainnet Production

- [ ] Production hook deployment uses proper permission validation.
- [ ] Governance uses Safe plus timelock policy for non-emergency changes.
- [ ] Quote signing uses EIP-712 typed data.
- [ ] Fuzz, invariant, gas, and integration tests are in CI.
- [ ] External audit is complete and critical findings are fixed.
- [ ] Monitoring, incident response, and customer communication process are live.
- [ ] Legal, terms, fee model, and SLA are approved.

## Incident Severity

| Severity | Example | Response |
| --- | --- | --- |
| P0 | Incorrect settlement, unauthorized admin action, or exploitable signature bypass | Pause quote intake, rotate keys if needed, publish incident notice, preserve forensic data |
| P1 | High fallback rate, indexer outage, or abnormal rejection spike | Switch to fallback mode, notify integrators, investigate Agent or RPC failures |
| P2 | Single Agent degraded, delayed metrics, partial dashboard outage | Disable affected Agent if needed, keep API status updated |
| P3 | Documentation, display, or non-critical reporting issue | Patch in normal release cycle |

## Production Positioning

Until all mainnet checklist items are complete, position ArenaV4Hook as a testnet-verified execution-quality protocol demo and enterprise evaluation package. That framing is strong, honest, and defensible for fundraising.
