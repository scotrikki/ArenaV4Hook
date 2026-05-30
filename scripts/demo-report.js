const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
const deploymentsDir = path.join(rootDir, "deployments");

function resolveDeploymentFile() {
  if (process.env.DEPLOYMENT_FILE) {
    return path.resolve(rootDir, process.env.DEPLOYMENT_FILE);
  }

  const preferred = path.join(deploymentsDir, "v4-xlayerTestnet-latest.json");
  if (fs.existsSync(preferred)) {
    return preferred;
  }

  if (!fs.existsSync(deploymentsDir)) {
    throw new Error("deployments directory not found");
  }

  const localProofs = fs
    .readdirSync(deploymentsDir)
    .filter((fileName) => /^v4-local-flow-.*\.json$/.test(fileName))
    .map((fileName) => path.join(deploymentsDir, fileName))
    .sort((left, right) => fs.statSync(right).mtimeMs - fs.statSync(left).mtimeMs);

  if (localProofs.length === 0) {
    throw new Error("No v4 deployment proof found. Run npm run v4:local-flow or deploy:v4:xlayer-testnet first.");
  }

  return localProofs[0];
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function compactAddress(address) {
  if (!address) {
    return "n/a";
  }
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function valueOf(data, paths, fallback = "n/a") {
  for (const pathSegments of paths) {
    let current = data;
    for (const segment of pathSegments) {
      current = current && current[segment];
    }
    if (current !== undefined && current !== null) {
      return current;
    }
  }
  return fallback;
}

function formatBps(value) {
  if (value === "n/a") {
    return value;
  }
  const bps = Number(value);
  if (!Number.isFinite(bps)) {
    return String(value);
  }
  return `${bps} bps (${(bps / 100).toFixed(2)}%)`;
}

function parseNumber(value) {
  if (value === undefined || value === null || value === "n/a") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatUnits(value) {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return "n/a";
  }
  return String(parsed);
}

function formatPercentFromRatio(value) {
  const parsed = parseNumber(value);
  if (parsed === null) {
    return "n/a";
  }
  return `${(parsed * 100).toFixed(2)}%`;
}

function explorerBase(network) {
  if (network === "xlayerTestnet") {
    return "https://www.oklink.com/xlayer-test";
  }
  if (network === "xlayer") {
    return "https://www.oklink.com/xlayer";
  }
  return null;
}

function explorerLink(base, type, value) {
  if (!base || !value || value === "n/a") {
    return value || "n/a";
  }
  return `${base}/${type}/${value}`;
}

function printSection(title, rows) {
  console.log(`\n${title}`);
  for (const [label, value] of rows) {
    console.log(`  ${label.padEnd(24)} ${value}`);
  }
}

function relativeDisplayPath(filePath) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function derivedEventStatus(data, eventName) {
  if (data.hookEvents && data.hookEvents[eventName] !== undefined) {
    return Boolean(data.hookEvents[eventName]);
  }
  if (eventName === "quoteWindowOpened") {
    return Boolean(data.txs?.swap && (data.quality || data.hookEvents?.swapQualityRecorded));
  }
  if (eventName === "quoteSubmitted") {
    return Boolean(data.selectedAgent || data.hookEvents?.quoteSelected?.agent);
  }
  return false;
}

function classifyOrder(data, quality) {
  const amountIn = parseNumber(valueOf(data, [["params", "swapAmountIn"], ["swapAmountIn"]]));
  const threshold = parseNumber(valueOf(data, [["params", "directSettleThreshold"], ["directSettleThreshold"]]));
  const quoteCount = parseNumber(quality.quoteCount);
  const usedFallback = quality.usedFallback;

  if (amountIn === null) {
    return {
      sizeClass: "unknown",
      routingMode: "unknown",
      rationale: "swap amount was not present in the proof file"
    };
  }

  const effectiveThreshold = threshold === null || threshold === 0 ? amountIn : threshold;
  if (amountIn < effectiveThreshold) {
    return {
      sizeClass: "small",
      routingMode: "direct-settle",
      rationale: `amountIn ${amountIn} is below directSettleThreshold ${effectiveThreshold}`
    };
  }

  if (quoteCount !== null && quoteCount >= 3) {
    return {
      sizeClass: "large",
      routingMode: "full-agent-auction",
      rationale: `${quoteCount} accepted quotes competed for this request`
    };
  }

  if (usedFallback === true) {
    return {
      sizeClass: "auction-eligible",
      routingMode: "fallback",
      rationale: "order was eligible for auction but no usable quote survived"
    };
  }

  return {
    sizeClass: "mid",
    routingMode: "light-agent-auction",
    rationale: "order cleared through an accepted agent quote"
  };
}

function buildSurplusLens(quality) {
  const baseline = parseNumber(quality.baselineAmountOut);
  const finalAmount = parseNumber(quality.finalAmountOut);
  const quoteCount = parseNumber(quality.quoteCount);
  const surplus = baseline === null || finalAmount === null ? null : finalAmount - baseline;
  const surplusRatio = surplus === null || baseline === null || baseline === 0 ? null : surplus / baseline;

  return {
    estimatedUserSurplus: surplus,
    surplusRatio,
    competitivePressure: quoteCount === null ? "n/a" : quoteCount <= 1 ? "single-agent" : `${quoteCount}-agent competition`,
    interpretation:
      surplus === null
        ? "not enough data to estimate surplus"
        : surplus > 0
          ? "agent quote improved execution versus the baseline pool output"
          : surplus === 0
            ? "agent quote matched the baseline pool output"
            : "fallback or selected quote underperformed the baseline"
  };
}

function buildAgentPassport(data, quality, agentStats, quoteSelected) {
  const submissions = parseNumber(agentStats.submissions) || 0;
  const wins = parseNumber(agentStats.wins) || 0;
  const positiveImprovement = parseNumber(agentStats.cumulativePositiveImprovementBps) || 0;
  const quoteCount = parseNumber(quality.quoteCount) || 0;
  const latency = parseNumber(quality.latencySeconds);
  const usedFallback = quality.usedFallback === true;
  const winRateBps = submissions === 0 ? 0 : Math.floor((wins * 10000) / submissions);
  const averagePositiveImprovementBps = wins === 0 ? 0 : Math.floor(positiveImprovement / wins);
  const acceptanceRate = quoteCount === 0 ? 0 : wins / quoteCount;
  const agent = quoteSelected.agent || data.selectedAgent || data.quoteAgent || "n/a";

  let style = "unclassified";
  if (usedFallback) {
    style = "fallback-observed";
  } else if (latency !== null && latency <= 1 && averagePositiveImprovementBps >= 300) {
    style = "fast-surplus-capturer";
  } else if (averagePositiveImprovementBps >= 100) {
    style = "price-improver";
  } else if (wins > 0) {
    style = "baseline-matcher";
  }

  return {
    agent,
    submissions,
    wins,
    winRateBps,
    averagePositiveImprovementBps,
    acceptanceRate,
    latencyProfile: latency === null ? "n/a" : latency <= 1 ? "instant" : `${latency}s`,
    reliabilitySignal: usedFallback ? "fallback-used" : wins > 0 ? "selected-and-settled" : "no-winning-quote",
    style
  };
}

function main() {
  const deploymentFile = resolveDeploymentFile();
  const data = readJson(deploymentFile);
  const base = explorerBase(data.network);
  const addresses = data.addresses || {};
  const quality = data.hookEvents?.swapQualityRecorded || data.quality || {};
  const quoteSelected = data.hookEvents?.quoteSelected || {};
  const agentStats = data.agentStats || {};
  const submissions = Number(agentStats.submissions || 0);
  const wins = Number(agentStats.wins || 0);
  const winRateBps = submissions === 0 ? 0 : Math.floor((wins * 10000) / submissions);
  const orderClassification = classifyOrder(data, quality);
  const surplusLens = buildSurplusLens(quality);
  const agentPassport = buildAgentPassport(data, quality, agentStats, quoteSelected);

  console.log("ArenaV4Hook Demo Report");
  console.log(`Source: ${relativeDisplayPath(deploymentFile)}`);

  printSection("Network", [
    ["generatedAt", data.generatedAt || "n/a"],
    ["network", data.network || "n/a"],
    ["chainId", data.chainId || "n/a"],
    ["deployer", compactAddress(data.deployer)]
  ]);

  printSection("Contracts", [
    ["poolManager", explorerLink(base, "address", addresses.poolManager || data.poolManager)],
    ["registry", explorerLink(base, "address", addresses.registry || data.registry)],
    ["hook", explorerLink(base, "address", addresses.hook || data.hook)],
    ["flowExecutor", explorerLink(base, "address", addresses.flowExecutor || data.flowExecutor)],
    ["token0", explorerLink(base, "address", addresses.token0 || data.token0)],
    ["token1", explorerLink(base, "address", addresses.token1 || data.token1)]
  ]);

  printSection("Hook Mining", [
    ["low14", valueOf(data, [["hookMining", "hookFlagLow14"], ["hookFlagLow14"]])],
    ["tries", valueOf(data, [["hookMining", "tries"]])],
    ["salt", valueOf(data, [["hookMining", "salt"], ["hookSalt"]])]
  ]);

  printSection("Transactions", [
    ["initialize", explorerLink(base, "tx", data.txs?.initialize)],
    ["addLiquidity", explorerLink(base, "tx", data.txs?.addLiquidity)],
    ["swap", explorerLink(base, "tx", data.txs?.swap)]
  ]);

  printSection("Hook Events", [
    ["QuoteWindowOpened", String(derivedEventStatus(data, "quoteWindowOpened"))],
    ["QuoteSubmitted", String(derivedEventStatus(data, "quoteSubmitted"))],
    ["QuoteSelected", quoteSelected.agent || data.selectedAgent || "n/a"],
    ["selectedAmountOut", quoteSelected.amountOut || data.selectedAmountOut || "n/a"]
  ]);

  printSection("Execution Quality", [
    ["baselineAmountOut", quality.baselineAmountOut || "n/a"],
    ["finalAmountOut", quality.finalAmountOut || "n/a"],
    ["improvement", formatBps(quality.improvementBps || "n/a")],
    ["quoteCount", quality.quoteCount || "n/a"],
    ["latencySeconds", quality.latencySeconds || "n/a"],
    ["usedFallback", String(quality.usedFallback ?? "n/a")]
  ]);

  printSection("Surplus Lens", [
    ["estimatedUserSurplus", formatUnits(surplusLens.estimatedUserSurplus)],
    ["surplusRatio", formatPercentFromRatio(surplusLens.surplusRatio)],
    ["competitivePressure", surplusLens.competitivePressure],
    ["interpretation", surplusLens.interpretation]
  ]);

  printSection("Order Intelligence", [
    ["swapAmountIn", valueOf(data, [["params", "swapAmountIn"], ["swapAmountIn"]])],
    ["directThreshold", valueOf(data, [["params", "directSettleThreshold"], ["directSettleThreshold"]])],
    ["sizeClass", orderClassification.sizeClass],
    ["routingMode", orderClassification.routingMode],
    ["rationale", orderClassification.rationale]
  ]);

  printSection("Agent Reputation", [
    ["agent", quoteSelected.agent || data.selectedAgent || data.quoteAgent || "n/a"],
    ["submissions", agentStats.submissions || "n/a"],
    ["wins", agentStats.wins || "n/a"],
    ["winRate", formatBps(winRateBps)],
    ["positiveImprovement", formatBps(agentStats.cumulativePositiveImprovementBps || "n/a")]
  ]);

  printSection("Agent Performance Passport", [
    ["agent", agentPassport.agent],
    ["style", agentPassport.style],
    ["winRate", formatBps(agentPassport.winRateBps)],
    ["avgPositiveImprove", formatBps(agentPassport.averagePositiveImprovementBps)],
    ["acceptanceRate", formatPercentFromRatio(agentPassport.acceptanceRate)],
    ["latencyProfile", agentPassport.latencyProfile],
    ["reliabilitySignal", agentPassport.reliabilitySignal]
  ]);

  printSection("Investor Summary", [
    ["productClaim", "programmable execution-quality market for v4 swaps"],
    ["proof", `${formatBps(quality.improvementBps || "n/a")} improvement with ${surplusLens.competitivePressure}`],
    ["nextInnovation", "agent passports, adaptive auctions, capability attestations"]
  ]);
}

main();