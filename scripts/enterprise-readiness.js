const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const deploymentsDir = path.join(rootDir, "deployments");

function fileExists(relativePath) {
  return fs.existsSync(path.join(rootDir, relativePath));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(rootDir, relativePath), "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function relativePath(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function resolveProofFile() {
  if (process.env.DEPLOYMENT_FILE) {
    return path.resolve(rootDir, process.env.DEPLOYMENT_FILE);
  }

  const preferred = path.join(deploymentsDir, "v4-xlayerTestnet-latest.json");
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  if (!fs.existsSync(deploymentsDir)) {
    return null;
  }

  const localProofs = fs
    .readdirSync(deploymentsDir)
    .filter((fileName) => /^v4-local-flow-.*\.json$/.test(fileName))
    .map((fileName) => path.join(deploymentsDir, fileName))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  return localProofs[0] || null;
}

function createCheck(label, passed, detail, weight = 0) {
  return { label, passed, detail, weight };
}

function statusIcon(passed) {
  return passed ? "PASS" : "MISS";
}

function printChecks(title, checks) {
  console.log(`\n${title}`);
  for (const check of checks) {
    console.log(`  [${statusIcon(check.passed)}] ${check.label} - ${check.detail}`);
  }
}

function score(checks) {
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  const passed = checks.filter((check) => check.passed).reduce((sum, check) => sum + check.weight, 0);
  if (total === 0) {
    return 0;
  }
  return Math.round((passed / total) * 100);
}

function getProofChecks(proofFile, proof) {
  if (!proofFile || !proof) {
    return [createCheck("deployment proof", false, "no proof file found", 20)];
  }

  const events = proof.hookEvents || {};
  const quality = events.swapQualityRecorded || proof.quality || {};
  const low14 = proof.hookMining?.hookFlagLow14 || proof.hookFlagLow14;
  const improvement = Number(quality.improvementBps);
  const quoteCount = Number(quality.quoteCount);

  return [
    createCheck("deployment proof", true, relativePath(proofFile), 15),
    createCheck("hook address permission bits", low14 === "0xc0", `low14=${low14 || "n/a"}`, 10),
    createCheck("quote window event", events.quoteWindowOpened === true, String(events.quoteWindowOpened === true), 5),
    createCheck("quote submission event", events.quoteSubmitted === true, String(events.quoteSubmitted === true), 5),
    createCheck("quality event", Boolean(events.swapQualityRecorded || proof.quality), "SwapQualityRecorded present", 10),
    createCheck("positive improvement evidence", Number.isFinite(improvement) && improvement > 0, `${quality.improvementBps || "n/a"} bps`, 10),
    createCheck("accepted quote evidence", Number.isFinite(quoteCount) && quoteCount > 0, `quoteCount=${quality.quoteCount || "n/a"}`, 5)
  ];
}

function getArtifactChecks() {
  const artifacts = [
    "docs/security-notes.md",
    "docs/execution-quality-market.md",
    "docs/enterprise-architecture.md",
    "docs/production-readiness-roadmap.md",
    "docs/api-reference.md",
    "docs/monitoring-runbook.md",
    "scripts/demo-report.js",
    "scripts/agent-leaderboard.js",
    "packages/sdk/index.js",
    "packages/sdk/README.md",
    "packages/api/server.js",
    "packages/api/README.md"
  ];

  return artifacts.map((artifact) => createCheck(artifact, fileExists(artifact), fileExists(artifact) ? "present" : "missing", 5));
}

function getProductionBlockers() {
  const arenaHook = readText("contracts/ArenaV4Hook.sol");
  const registry = readText("contracts/AgentQuoteRegistry.sol");
  const hasNoopHookValidation = /function\s+validateHookAddress[\s\S]*?\{\s*\}/.test(arenaHook);
  const hasEip712 = /EIP712|DOMAIN_SEPARATOR|_hashTypedDataV4/.test(arenaHook);
  const hasPausable = /Pausable|whenNotPaused|whenPaused|_pause\(/.test(arenaHook) || /Pausable|whenNotPaused|whenPaused|_pause\(/.test(registry);
  const hasSimpleOwner = /address\s+public\s+owner/.test(registry);

  return [
    createCheck("production hook validation", !hasNoopHookValidation, hasNoopHookValidation ? "blocked by demo no-op" : "enabled"),
    createCheck("EIP-712 typed signing", hasEip712, hasEip712 ? "detected" : "not implemented"),
    createCheck("pause controls", hasPausable, hasPausable ? "detected" : "not implemented"),
    createCheck("multisig/timelock governance", !hasSimpleOwner, hasSimpleOwner ? "registry still uses simple owner" : "simple owner not detected")
  ];
}

function main() {
  const proofFile = resolveProofFile();
  const proof = proofFile ? readJson(proofFile) : null;
  const proofChecks = getProofChecks(proofFile, proof);
  const artifactChecks = getArtifactChecks();
  const blockerChecks = getProductionBlockers();
  const demoScore = score([...proofChecks, ...artifactChecks]);
  const testnetDemoReady = demoScore >= 80 && proofChecks.every((check) => check.passed);
  const productionReady = blockerChecks.every((check) => check.passed);

  console.log("ArenaV4Hook Enterprise Readiness");
  console.log(`Generated at: ${new Date().toISOString()}`);

  printChecks("Testnet Evidence", proofChecks);
  printChecks("Enterprise Artifacts", artifactChecks);
  printChecks("Production Blockers", blockerChecks);

  console.log("\nDecision");
  console.log(`  Testnet enterprise demo: ${testnetDemoReady ? "GO" : "NO-GO"} (${demoScore}/100)`);
  console.log(`  Mainnet production: ${productionReady ? "GO" : "NO-GO"}`);

  console.log("\nNext Actions");
  if (!testnetDemoReady) {
    console.log("  - Refresh the xLayer or local v4 proof and rerun npm run demo:report.");
  }
  console.log("  - Build the event indexer/API described in docs/api-reference.md.");
  console.log("  - Add EIP-712 quote signing before production integrations.");
  console.log("  - Move admin powers to Safe and add pause controls before private beta.");
  console.log("  - Run fuzz, gas, monitoring, and audit gates before mainnet.");
}

main();
