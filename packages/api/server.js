const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const rootDir = path.resolve(__dirname, "..", "..");
const deploymentsDir = path.join(rootDir, "deployments");
const port = Number(process.env.PORT || 8787);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function proofFiles() {
  if (!fs.existsSync(deploymentsDir)) {
    return [];
  }

  return fs
    .readdirSync(deploymentsDir)
    .filter((fileName) => /^v4-(local-flow-.*|xlayerTestnet-.*|xlayerTestnet-latest)\.json$/.test(fileName))
    .map((fileName) => path.join(deploymentsDir, fileName));
}

function selectedAgent(data) {
  return data.hookEvents?.quoteSelected?.agent || data.selectedAgent || data.quoteAgent || "unknown";
}

function quality(data) {
  return data.hookEvents?.swapQualityRecorded || data.quality || {};
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatBps(value) {
  return String(Math.round(value));
}

function requestIdOf(data, filePath) {
  return data.requestId || data.request?.requestId || data.hookEvents?.quoteSelected?.requestId || `proof:${relativePath(filePath)}`;
}

function proofIdentity(data, filePath) {
  return data.requestId || data.request?.requestId || data.hookEvents?.quoteSelected?.requestId || data.txs?.swap || relativePath(filePath);
}

function loadProofs() {
  const seen = new Set();
  const proofs = [];

  const files = proofFiles().sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  for (const filePath of files) {
    const data = readJson(filePath);
    const identity = proofIdentity(data, filePath);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    proofs.push({ filePath, data, identity });
  }

  return proofs.sort((left, right) => {
    const leftSchema = left.data.schemaVersion === "arena-proof-v1" ? 1 : 0;
    const rightSchema = right.data.schemaVersion === "arena-proof-v1" ? 1 : 0;
    if (leftSchema !== rightSchema) {
      return rightSchema - leftSchema;
    }
    return fs.statSync(right.filePath).mtimeMs - fs.statSync(left.filePath).mtimeMs;
  });
}

function buildAgents(proofs) {
  const agents = new Map();

  for (const proof of proofs) {
    const data = proof.data;
    const agentAddress = selectedAgent(data);
    if (agentAddress === "unknown") {
      continue;
    }
    const key = agentAddress.toLowerCase();
    const current = agents.get(key) || {
      agent: agentAddress,
      status: "whitelisted",
      submissions: 0,
      wins: 0,
      cumulativePositiveImprovementBps: 0,
      proofs: 0,
      lastProofFile: null,
      networks: new Set()
    };
    const eventQuality = quality(data);
    const stats = data.agentStats || {};
    current.submissions += parseNumber(stats.submissions) || parseNumber(eventQuality.quoteCount);
    current.wins += parseNumber(stats.wins) || 1;
    current.cumulativePositiveImprovementBps += parseNumber(stats.cumulativePositiveImprovementBps) || parseNumber(eventQuality.improvementBps);
    current.proofs += 1;
    current.lastProofFile = relativePath(proof.filePath);
    current.networks.add(data.network || "unknown");
    agents.set(key, current);
  }

  return [...agents.values()].map((agent) => {
    const averagePositiveImprovementBps = agent.wins === 0 ? 0 : agent.cumulativePositiveImprovementBps / agent.wins;
    const winRateBps = agent.submissions === 0 ? 0 : Math.floor((agent.wins * 10000) / agent.submissions);
    return {
      agent: agent.agent,
      status: agent.status,
      submissions: String(agent.submissions),
      wins: String(agent.wins),
      winRateBps: String(winRateBps),
      averagePositiveImprovementBps: formatBps(averagePositiveImprovementBps),
      passportStyle: averagePositiveImprovementBps >= 300 ? "fast-surplus-capturer" : "price-improver",
      networks: [...agent.networks],
      lastProofFile: agent.lastProofFile
    };
  });
}

function buildRequests(proofs) {
  return proofs.map((proof) => {
    const data = proof.data;
    const eventQuality = quality(data);
    const requestId = requestIdOf(data, proof.filePath);
    return {
      requestId,
      identity: proof.identity,
      schemaVersion: data.schemaVersion || "legacy-proof",
      network: data.network || "unknown",
      chainId: data.chainId || "n/a",
      tokenIn: data.addresses?.token0 || data.tokenIn || "n/a",
      tokenOut: data.addresses?.token1 || data.tokenOut || "n/a",
      amountIn: data.request?.amountIn || data.params?.swapAmountIn || data.swapAmountIn || "n/a",
      quoteCount: eventQuality.quoteCount || "0",
      status: eventQuality.usedFallback === true ? "fallback" : "settled",
      selectedAgent: selectedAgent(data),
      proofFile: relativePath(proof.filePath),
      swapTx: data.txs?.swap || "n/a",
      settlement: {
        selectedAgent: selectedAgent(data),
        baselineAmountOut: eventQuality.baselineAmountOut || "n/a",
        finalAmountOut: eventQuality.finalAmountOut || "n/a",
        improvementBps: eventQuality.improvementBps || "n/a",
        quoteCount: eventQuality.quoteCount || "0",
        latencySeconds: eventQuality.latencySeconds || "n/a",
        usedFallback: eventQuality.usedFallback === true
      }
    };
  });
}

function buildQualitySummary(requests) {
  const settled = requests.filter((request) => request.status === "settled" || request.status === "fallback");
  const fallbacks = requests.filter((request) => request.settlement.usedFallback);
  const totalImprovement = settled.reduce((sum, request) => sum + parseNumber(request.settlement.improvementBps), 0);
  const topAgents = [...new Set(settled.map((request) => request.selectedAgent).filter((agent) => agent !== "unknown"))];

  return {
    requests: String(requests.length),
    settled: String(settled.length),
    fallbacks: String(fallbacks.length),
    fallbackRateBps: settled.length === 0 ? "0" : String(Math.floor((fallbacks.length * 10000) / settled.length)),
    averageImprovementBps: settled.length === 0 ? "0" : formatBps(totalImprovement / settled.length),
    topAgents
  };
}

function latestProof(proofs) {
  const schemaProof = proofs.find((proof) => proof.data.schemaVersion === "arena-proof-v1");
  if (schemaProof) {
    return schemaProof;
  }
  const xlayer = proofs.find((proof) => path.basename(proof.filePath) === "v4-xlayerTestnet-latest.json");
  return xlayer || proofs[0] || null;
}

function buildHookStatus(proofs) {
  const latest = latestProof(proofs);
  if (!latest) {
    return { testnetDemoReady: false, mainnetProductionReady: false };
  }
  const data = latest.data;
  const events = data.hookEvents || {};
  const eventQuality = quality(data);
  return {
    network: data.network || "unknown",
    chainId: data.chainId || "n/a",
    hook: data.addresses?.hook || data.hook || "n/a",
    registry: data.addresses?.registry || data.registry || "n/a",
    low14: data.hookMining?.hookFlagLow14 || data.hookFlagLow14 || "n/a",
    latestProofFile: relativePath(latest.filePath),
    latestRequestId: requestIdOf(data, latest.filePath),
    testnetDemoReady: events.quoteWindowOpened === true && Boolean(eventQuality.improvementBps),
    mainnetProductionReady: false
  };
}

function filterRequests(requests, searchParams) {
  const network = searchParams.get("network");
  const agent = searchParams.get("agent");
  const status = searchParams.get("status");
  const limit = Math.min(Number(searchParams.get("limit") || 50), 200);

  return requests
    .filter((request) => !network || request.network === network)
    .filter((request) => !agent || request.selectedAgent.toLowerCase() === agent.toLowerCase())
    .filter((request) => !status || status === "all" || request.status === status)
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : 50);
}

function proofSummary(proofs) {
  return proofs.map((proof) => ({
    identity: proof.identity,
    requestId: requestIdOf(proof.data, proof.filePath),
    schemaVersion: proof.data.schemaVersion || "legacy-proof",
    network: proof.data.network || "unknown",
    swapTx: proof.data.txs?.swap || "n/a",
    proofFile: relativePath(proof.filePath)
  }));
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*"
  });
  response.end(JSON.stringify(payload, null, 2));
}

function route(request, response) {
  const proofs = loadProofs();
  const agents = buildAgents(proofs);
  const requests = buildRequests(proofs);
  const url = new URL(request.url, `http://${request.headers.host}`);
  const pathname = url.pathname.replace(/\/$/, "");

  if (pathname === "" || pathname === "/v1") {
    sendJson(response, 200, {
      service: "ArenaV4Hook Enterprise API Prototype",
      endpoints: ["/v1/health", "/v1/agents", "/v1/requests", "/v1/proofs", "/v1/hook/status", "/v1/quality/summary"]
    });
    return;
  }

  if (pathname === "/v1/health") {
    sendJson(response, 200, {
      ok: true,
      proofCount: proofs.length,
      latestProofFile: latestProof(proofs) ? relativePath(latestProof(proofs).filePath) : null
    });
    return;
  }

  if (pathname === "/v1/agents") {
    sendJson(response, 200, { agents });
    return;
  }

  if (pathname.startsWith("/v1/agents/")) {
    const agentAddress = pathname.split("/").pop().toLowerCase();
    const agent = agents.find((item) => item.agent.toLowerCase() === agentAddress);
    sendJson(response, agent ? 200 : 404, agent || { error: "agent not found" });
    return;
  }

  if (pathname === "/v1/requests") {
    sendJson(response, 200, { requests: filterRequests(requests, url.searchParams) });
    return;
  }

  if (pathname.startsWith("/v1/requests/")) {
    const requestId = decodeURIComponent(pathname.split("/").pop());
    const found = requests.find((item) => item.requestId === requestId || item.identity === requestId || item.proofFile.endsWith(requestId));
    sendJson(response, found ? 200 : 404, found || { error: "request not found" });
    return;
  }

  if (pathname === "/v1/proofs") {
    sendJson(response, 200, { proofs: proofSummary(proofs) });
    return;
  }

  if (pathname === "/v1/hook/status") {
    sendJson(response, 200, buildHookStatus(proofs));
    return;
  }

  if (pathname === "/v1/quality/summary") {
    sendJson(response, 200, buildQualitySummary(requests));
    return;
  }

  sendJson(response, 404, { error: "not found" });
}

const server = http.createServer(route);

server.listen(port, () => {
  console.log(`ArenaV4Hook Enterprise API prototype listening on http://localhost:${port}/v1`);
});
