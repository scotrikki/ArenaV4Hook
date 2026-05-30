# ArenaV4Hook Enterprise API Prototype

This is a dependency-free local API prototype backed by the existing proof files in `deployments/`. It gives demos and future dashboard work a real read-only interface before a production indexer or subgraph exists.

## Start

```bash
npm run api:dev
```

Default URL:

```text
http://localhost:8787/v1
```

Use a custom port:

```bash
PORT=8790 npm run api:dev
```

PowerShell:

```powershell
$env:PORT="8790"; npm run api:dev; Remove-Item Env:PORT
```

## Endpoints

- `GET /v1/agents`
- `GET /v1/agents/{agent}`
- `GET /v1/requests`
- `GET /v1/requests/{requestId}`
- `GET /v1/hook/status`
- `GET /v1/quality/summary`

## Scope

This service reads static proof JSON on every request. It is useful for enterprise demos, dashboard prototyping, and integration contract review. Production should replace the proof-file backing store with an event indexer or subgraph.
