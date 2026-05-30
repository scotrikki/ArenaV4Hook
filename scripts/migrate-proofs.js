const fs = require("fs");
const path = require("path");
const { computeRequestId } = require("../packages/sdk");

const rootDir = path.resolve(__dirname, "..");
const deploymentsDir = path.join(rootDir, "deployments");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
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
    .map((fileName) => path.join(deploymentsDir, fileName));
}

function valueOf(data, paths) {
  for (const pathSegments of paths) {
    let current = data;
    for (const segment of pathSegments) {
      current = current && current[segment];
    }
    if (current !== undefined && current !== null) {
      return current;
    }
  }
  return undefined;
}

function requestParams(data) {
  const tokenIn = valueOf(data, [["request", "tokenIn"], ["addresses", "token0"], ["token0"]]);
  const tokenOut = valueOf(data, [["request", "tokenOut"], ["addresses", "token1"], ["token1"]]);
  const user = valueOf(data, [["request", "user"], ["deployer"], ["user"]]);
  const amountIn = valueOf(data, [["request", "amountIn"], ["params", "swapAmountIn"], ["swapAmountIn"]]);
  const requestSalt = valueOf(data, [["request", "requestSalt"], ["requestSalt"]]);

  if (!tokenIn || !tokenOut || !user || !amountIn || !requestSalt) {
    return null;
  }

  return {
    sender: user,
    amountIn,
    tokenIn,
    tokenOut,
    zeroForOne: true,
    requestSalt
  };
}

function migrateProof(data) {
  const params = requestParams(data);
  const requestId = data.requestId || data.request?.requestId || (params ? computeRequestId(params) : null);
  if (!requestId) {
    return { migrated: false, data, reason: "missing request parameters" };
  }

  const quoteSelected = data.hookEvents?.quoteSelected || {};
  const quality = data.hookEvents?.swapQualityRecorded || data.quality || {};
  const requestSalt = valueOf(data, [["request", "requestSalt"], ["requestSalt"]]);
  const quoteAgent = data.quoteAgent || data.agent || quoteSelected.agent || data.selectedAgent || "unknown";
  const amountIn = valueOf(data, [["request", "amountIn"], ["params", "swapAmountIn"], ["swapAmountIn"]]);
  const minAmountOut = valueOf(data, [["request", "minAmountOut"], ["params", "minAmountOut"], ["minAmountOut"]]) || "0";

  const migrated = {
    schemaVersion: "arena-proof-v1",
    ...data,
    requestId,
    requestSalt,
    quoteAgent,
    signatureVersion: data.signatureVersion || data.request?.signatureVersion || "erc191-demo",
    request: {
      requestId,
      requestSalt,
      user: valueOf(data, [["request", "user"], ["deployer"], ["user"]]),
      tokenIn: valueOf(data, [["request", "tokenIn"], ["addresses", "token0"], ["token0"]]),
      tokenOut: valueOf(data, [["request", "tokenOut"], ["addresses", "token1"], ["token1"]]),
      zeroForOne: true,
      amountIn: String(amountIn),
      minAmountOut: String(minAmountOut),
      quoteDeadline: valueOf(data, [["request", "quoteDeadline"]]) || "n/a",
      validUntil: valueOf(data, [["request", "validUntil"]]) || "n/a",
      nonce: valueOf(data, [["request", "nonce"]]) || "n/a",
      signatureVersion: data.signatureVersion || data.request?.signatureVersion || "erc191-demo"
    },
    hookEvents: {
      ...(data.hookEvents || {}),
      quoteWindowOpened: data.hookEvents?.quoteWindowOpened ?? Boolean(data.txs?.swap),
      quoteSubmitted: data.hookEvents?.quoteSubmitted ?? Boolean(quoteSelected.agent || data.selectedAgent || data.quoteAgent),
      quoteSelected: {
        requestId,
        agent: quoteSelected.agent || data.selectedAgent || quoteAgent,
        amountOut: quoteSelected.amountOut || data.selectedAmountOut || valueOf(data, [["params", "quotedAmountOut"]]) || "n/a"
      },
      swapQualityRecorded: {
        requestId,
        baselineAmountOut: quality.baselineAmountOut || "n/a",
        finalAmountOut: quality.finalAmountOut || "n/a",
        improvementBps: quality.improvementBps || "n/a",
        quoteCount: quality.quoteCount || "0",
        latencySeconds: quality.latencySeconds || "n/a",
        usedFallback: quality.usedFallback === true
      }
    }
  };

  if (!migrated.addresses && data.poolManager) {
    migrated.addresses = {
      poolManager: data.poolManager,
      token0: data.token0,
      token1: data.token1,
      registry: data.registry,
      create2Factory: data.create2Factory,
      hook: data.hook,
      flowExecutor: data.flowExecutor
    };
  }

  if (!migrated.params && amountIn) {
    migrated.params = {
      swapAmountIn: String(amountIn),
      quotedAmountOut: migrated.hookEvents.quoteSelected.amountOut,
      minAmountOut: String(minAmountOut)
    };
  }

  if (!migrated.hookMining && data.hookSalt) {
    migrated.hookMining = {
      salt: data.hookSalt,
      hookFlagLow14: data.hookFlagLow14
    };
  }

  return { migrated: true, data: migrated };
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const files = proofFiles();
  let migratedCount = 0;
  let skippedCount = 0;

  for (const filePath of files) {
    const data = readJson(filePath);
    const result = migrateProof(data);
    const relative = path.relative(rootDir, filePath).split(path.sep).join("/");
    if (!result.migrated) {
      skippedCount += 1;
      console.log(`[SKIP] ${relative} - ${result.reason}`);
      continue;
    }

    migratedCount += 1;
    if (!dryRun) {
      writeJson(filePath, result.data);
    }
    console.log(`[${dryRun ? "DRY" : "OK"}] ${relative} -> ${result.data.requestId}`);
  }

  console.log(`\nProof migration complete. migrated=${migratedCount} skipped=${skippedCount} dryRun=${dryRun}`);
}

main();
