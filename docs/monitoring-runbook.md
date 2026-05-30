# Monitoring Runbook

This runbook defines the minimum operating model for an enterprise ArenaV4Hook deployment. It is designed for OpenZeppelin Monitor, a custom event worker, or a subgraph plus alerting stack.

## Event Sources

Monitor these events from `ArenaV4Hook`:

- `QuoteWindowOpened`
- `QuoteSubmitted`
- `QuoteRejected`
- `QuoteSelected`
- `SwapQualityRecorded`

Monitor these events or state transitions from `AgentQuoteRegistry`:

- Agent whitelist changes
- Hook binding changes
- Agent submission and win statistics

## Core Metrics

| Metric | Source | Reason |
| --- | --- | --- |
| `arena_requests_total` | `QuoteWindowOpened` | Demand and routing volume |
| `arena_quotes_submitted_total` | `QuoteSubmitted` | Agent participation |
| `arena_quotes_rejected_total` | `QuoteRejected` | Invalid nonce, expiry, signature, or whitelist issues |
| `arena_settlements_total` | `SwapQualityRecorded` | Completed lifecycle count |
| `arena_fallback_rate_bps` | `SwapQualityRecorded.usedFallback` | User experience and Agent coverage |
| `arena_average_improvement_bps` | `SwapQualityRecorded.improvementBps` | Execution-quality value |
| `arena_latency_seconds` | `SwapQualityRecorded.latencySeconds` | Quote window performance |
| `arena_agent_win_rate_bps` | registry stats | Agent reputation and concentration |

## Alert Rules

| Rule | Severity | Trigger | First response |
| --- | --- | --- | --- |
| Missing settlement | P1 | Request opened but no `SwapQualityRecorded` after expected window | Check indexer lag, swap tx status, and hook event decoding |
| High fallback rate | P1 | Fallback rate above 2000 bps over 30 minutes | Check Agent availability, RPC health, quote gateway, and whitelist status |
| Rejection spike | P1 | `QuoteRejected` rate above baseline by 3x | Group by reason; inspect nonce, signature version, and clock drift |
| Invalid signature cluster | P1 | Same Agent has repeated invalid signatures | Disable Agent if needed and request key/signing review |
| No quote competition | P2 | `quoteCount` stays below target for eligible orders | Add Agent coverage or adjust quote window settings |
| Negative or zero improvement streak | P2 | Improvement at or below zero across repeated eligible orders | Review baseline calculation, Agent quality, and routing thresholds |
| Admin change detected | P0/P1 | Hook binding or whitelist changes outside approved window | Verify Safe transaction, pause if unauthorized |

## Dashboards

The first operator dashboard should show:

- live request count and settlement count;
- fallback rate and quote rejection rate;
- average and percentile `improvementBps`;
- median and percentile `latencySeconds`;
- top Agents by submissions, wins, and positive improvement;
- latest incidents and acknowledged alerts;
- deployment status: chain ID, hook, registry, hook flag low bits, latest indexed block.

## Incident Workflow

1. Confirm whether the issue is on-chain, indexer/API, Agent, or dashboard-only.
2. Preserve evidence: transaction hashes, block numbers, event payloads, logs, RPC responses, and operator actions.
3. If user execution can be affected, switch to fallback mode or pause quote intake once pause controls exist.
4. Notify integrators with impact, mitigation, and next update time.
5. After resolution, publish a short postmortem with root cause, timeline, blast radius, and follow-up tasks.

## OpenZeppelin Monitor Mapping

OpenZeppelin Monitor can watch contract events, apply expression filters, and route notifications to Slack, Discord, email, Telegram, webhooks, or custom scripts. A production deployment should keep secrets outside config files and use multiple RPC endpoints with missed-block recovery.

Suggested monitors:

| Monitor | Filter |
| --- | --- |
| Fallback monitor | `SwapQualityRecorded.usedFallback == true` |
| Rejection monitor | Any `QuoteRejected`, grouped by reason |
| High-value request monitor | `QuoteWindowOpened.amountIn` above configured threshold |
| Admin monitor | Registry hook or whitelist changes |
| Quality monitor | `SwapQualityRecorded.improvementBps` below configured floor |

## Runbook Commands

Use these commands during demos and operational checks:

```bash
npm test
npm run v4:local-flow
npm run demo:report
npm run enterprise:check
```

The final command prints current testnet demo readiness and the remaining production blockers.
