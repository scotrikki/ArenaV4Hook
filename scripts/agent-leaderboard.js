const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const deploymentsDir = path.join(rootDir, "deployments");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function proofFiles() {
  if (process.env.DEPLOYMENT_FILE) {
    return [path.resolve(rootDir, process.env.DEPLOYMENT_FILE)];
  }

  if (!fs.existsSync(deploymentsDir)) {
    return [];
  }

  return fs
    .readdirSync(deploymentsDir)
    .filter((fileName) => /^v4-(local-flow-.*|xlayerTestnet-.*|xlayerTestnet-latest)\.json$/.test(fileName))
    .map((fileName) => path.join(deploymentsDir, fileName))
    .sort();
}

function parseNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compactAddress(address) {
  if (!address) {
    return "n/a";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function selectedAgent(data) {
  return data.hookEvents?.quoteSelected?.agent || data.selectedAgent || data.quoteAgent || "unknown";
}

function quality(data) {
  return data.hookEvents?.swapQualityRecorded || data.quality || {};
}

function proofIdentity(data, filePath) {
  return data.requestId || data.request?.requestId || data.hookEvents?.quoteSelected?.requestId || data.txs?.swap || relativePath(filePath);
}

function uniqueProofs(files) {
  const seen = new Set();
  const proofs = [];

  for (const filePath of files) {
    const data = readJson(filePath);
    const identity = proofIdentity(data, filePath);
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
    proofs.push({ filePath, data, identity });
  }

  return proofs;
}

function addProof(agents, proof) {
  const { filePath, data } = proof;
  const agent = selectedAgent(data).toLowerCase();
  const current = agents.get(agent) || {
    agent,
    displayAgent: selectedAgent(data),
    proofs: 0,
    submissions: 0,
    wins: 0,
    cumulativeImprovementBps: 0,
    totalSurplus: 0,
    fallbacks: 0,
    networks: new Set(),
    files: []
  };
  const stats = data.agentStats || {};
  const eventQuality = quality(data);
  const baseline = parseNumber(eventQuality.baselineAmountOut);
  const finalAmount = parseNumber(eventQuality.finalAmountOut);
  const improvement = parseNumber(eventQuality.improvementBps);
  const submissions = parseNumber(stats.submissions) || parseNumber(eventQuality.quoteCount);
  const wins = parseNumber(stats.wins) || (selectedAgent(data) === "unknown" ? 0 : 1);

  current.proofs += 1;
  current.submissions += submissions;
  current.wins += wins;
  current.cumulativeImprovementBps += improvement;
  current.totalSurplus += finalAmount - baseline;
  current.fallbacks += eventQuality.usedFallback === true ? 1 : 0;
  current.networks.add(data.network || "unknown");
  current.files.push(relativePath(filePath));
  agents.set(agent, current);
}

function formatBps(value) {
  return `${Math.round(value)} bps (${(value / 100).toFixed(2)}%)`;
}

function main() {
  const files = proofFiles();
  const proofs = uniqueProofs(files);
  const agents = new Map();

  for (const proof of proofs) {
    const { data } = proof;
    if (quality(data).usedFallback === true && selectedAgent(data) === "unknown") {
      continue;
    }
    addProof(agents, proof);
  }

  const rows = [...agents.values()]
    .map((agent) => ({
      ...agent,
      averageImprovementBps: agent.proofs === 0 ? 0 : agent.cumulativeImprovementBps / agent.proofs,
      winRateBps: agent.submissions === 0 ? 0 : Math.floor((agent.wins * 10000) / agent.submissions),
      networksDisplay: [...agent.networks].join(", ")
    }))
    .sort((left, right) => right.averageImprovementBps - left.averageImprovementBps || right.wins - left.wins);

  console.log("ArenaV4Hook Agent Leaderboard");
  console.log(`Proof files scanned: ${files.length}`);
  console.log(`Unique proofs counted: ${proofs.length}`);

  if (rows.length === 0) {
    console.log("No selected Agent proofs found. Run npm run v4:local-flow or deploy:v4:xlayer-testnet first.");
    return;
  }

  for (const [index, row] of rows.entries()) {
    console.log(`\n#${index + 1} ${compactAddress(row.displayAgent)}`);
    console.log(`  agent                    ${row.displayAgent}`);
    console.log(`  networks                 ${row.networksDisplay}`);
    console.log(`  proofs                   ${row.proofs}`);
    console.log(`  submissions              ${row.submissions}`);
    console.log(`  wins                     ${row.wins}`);
    console.log(`  winRate                  ${formatBps(row.winRateBps)}`);
    console.log(`  avgImprovement           ${formatBps(row.averageImprovementBps)}`);
    console.log(`  estimatedUserSurplus     ${row.totalSurplus}`);
    console.log(`  fallbacks                ${row.fallbacks}`);
    console.log(`  latestProof              ${row.files[row.files.length - 1]}`);
  }
}

main();
