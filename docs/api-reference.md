# Enterprise API Reference

This document defines the first enterprise API contract for ArenaV4Hook. A local proof-file prototype is available in `packages/api`; production should replace that backing store with an event indexer or subgraph.

The API is intentionally read-heavy. State changes should happen on-chain or through explicitly governed relayer workflows.

## Base URL

```text
https://api.arena.example/v1
```

Local prototype:

```text
http://localhost:8787/v1
```

## Common Fields

| Field | Type | Description |
| --- | --- | --- |
| `chainId` | string | Chain ID as a decimal string |
| `network` | string | Network slug, for example `xlayerTestnet` |
| `requestId` | bytes32 | Deterministic request ID emitted by the hook |
| `agent` | address | Whitelisted Agent address |
| `amountOut` | string | Token amount as a base-unit decimal string |
| `improvementBps` | string | Improvement in basis points |
| `usedFallback` | boolean | Whether settlement used the baseline swap output |

## `GET /agents`

Returns known Agents and their execution-quality summary.

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `network` | no | Filter by network |
| `pair` | no | Filter by token pair once capabilities are indexed |
| `status` | no | `whitelisted`, `disabled`, or `all` |

Example response:

```json
{
  "agents": [
    {
      "agent": "0x6a20340b51Db6869EF80b44484c5C364d13B2397",
      "status": "whitelisted",
      "submissions": "1",
      "wins": "1",
      "winRateBps": "10000",
      "averagePositiveImprovementBps": "483",
      "lastActiveBlock": "n/a",
      "passportStyle": "fast-surplus-capturer"
    }
  ]
}
```

## `GET /agents/{agent}`

Returns a single Agent Performance Passport.

Example response:

```json
{
  "agent": "0x6a20340b51Db6869EF80b44484c5C364d13B2397",
  "whitelisted": true,
  "submissions": "1",
  "wins": "1",
  "winRateBps": "10000",
  "cumulativePositiveImprovementBps": "483",
  "averagePositiveImprovementBps": "483",
  "latencyProfile": "instant",
  "reliabilitySignal": "selected-and-settled",
  "supportedPairs": []
}
```

## `GET /requests`

Returns recent quote requests.

Query parameters:

| Name | Required | Description |
| --- | --- | --- |
| `network` | no | Network slug |
| `agent` | no | Requests where this Agent submitted or won |
| `status` | no | `open`, `settled`, `fallback`, `all` |
| `limit` | no | Default `50`, max `200` |

Example response:

```json
{
  "requests": [
    {
      "requestId": "0x...",
      "network": "xlayerTestnet",
      "tokenIn": "0x83C2086a0098E3e41C2C40dC68664d0e20dA9b56",
      "tokenOut": "0xB5d42B530480425e84351Aa429f454cEfa71F482",
      "amountIn": "5000",
      "quoteCount": "1",
      "status": "settled",
      "openedAt": "n/a"
    }
  ]
}
```

## `GET /requests/{requestId}`

Returns the full request, quote, and settlement record.

Example response:

```json
{
  "requestId": "0x...",
  "status": "settled",
  "quotes": [
    {
      "agent": "0x6a20340b51Db6869EF80b44484c5C364d13B2397",
      "amountOut": "5200",
      "validUntil": "n/a",
      "accepted": true,
      "rejectionReason": null
    }
  ],
  "settlement": {
    "selectedAgent": "0x6a20340b51Db6869EF80b44484c5C364d13B2397",
    "baselineAmountOut": "4960",
    "finalAmountOut": "5200",
    "improvementBps": "483",
    "quoteCount": "1",
    "latencySeconds": "0",
    "usedFallback": false
  }
}
```

## `GET /hook/status`

Returns deployment and operational status.

Example response:

```json
{
  "network": "xlayerTestnet",
  "chainId": "1952",
  "hook": "0x7B6ACD38C28225Fd226BFe165Aa1ac646BB9C0C0",
  "registry": "0xA1dcb079c9F536f62747c10a8522f8D3b208fb86",
  "low14": "0xc0",
  "latestProofFile": "deployments/v4-xlayerTestnet-latest.json",
  "testnetDemoReady": true,
  "mainnetProductionReady": false
}
```

## `GET /quality/summary`

Returns aggregate execution-quality metrics for dashboards and monthly enterprise reports.

Example response:

```json
{
  "requests": "1",
  "settled": "1",
  "fallbacks": "0",
  "fallbackRateBps": "0",
  "averageImprovementBps": "483",
  "medianLatencySeconds": "0",
  "topAgents": ["0x6a20340b51Db6869EF80b44484c5C364d13B2397"]
}
```

## WebSocket `/events/subscribe`

Streams indexed hook events.

Subscribe message:

```json
{
  "type": "subscribe",
  "network": "xlayerTestnet",
  "events": ["QuoteRejected", "SwapQualityRecorded"]
}
```

Event message:

```json
{
  "type": "SwapQualityRecorded",
  "network": "xlayerTestnet",
  "requestId": "0x...",
  "baselineAmountOut": "4960",
  "finalAmountOut": "5200",
  "improvementBps": "483",
  "quoteCount": "1",
  "latencySeconds": "0",
  "usedFallback": false,
  "transactionHash": "0xe9bb9827961918fe2fa4b823baf828cdb565755ca3821f0e3e5aafa7410910b1"
}
```

## Signing Compatibility

Current demo quote signing covers:

```text
address(this), block.chainid, requestId, amountOut, validUntil, nonce
```

Production API and SDK work should introduce an EIP-712 domain and typed `AgentQuote` struct. During migration, the API should expose a `signatureVersion` field with values such as `erc191-demo` and `eip712-v1`.
