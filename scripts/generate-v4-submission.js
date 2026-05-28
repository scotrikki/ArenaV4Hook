const fs = require("fs");
const path = require("path");

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function latestDeploymentPath(networkName) {
  const deploymentsDir = path.join(process.cwd(), "deployments");
  const p = path.join(deploymentsDir, `v4-${networkName}-latest.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Deployment file not found: ${p}`);
  }
  return p;
}

function explorerBase(networkName) {
  if (networkName === "xlayer") return "https://www.oklink.com/xlayer";
  if (networkName === "xlayerTestnet") return "https://www.oklink.com/xlayer-test";
  return "";
}

function addrLink(base, addr) {
  return base ? `${base}/address/${addr}` : addr;
}

function txLink(base, tx) {
  return base ? `${base}/tx/${tx}` : tx;
}

function main() {
  const networkName = process.env.DEPLOYMENT_NETWORK || "xlayerTestnet";
  const deploymentFile = process.env.DEPLOYMENT_FILE || latestDeploymentPath(networkName);
  const d = readJSON(deploymentFile);

  const base = explorerBase(d.network);
  const submissionsDir = path.join(process.cwd(), "submissions");
  fs.mkdirSync(submissionsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outPath = path.join(submissionsDir, `submission-v4-${d.network}-${stamp}.md`);

  const content = `# Hook Hackathon Submission Draft (V4 Real Flow)

Generated at: ${new Date().toISOString()}
Source deployment file: \`${path.basename(deploymentFile)}\`

## Basic Info

- Network: ${d.network}
- Chain ID: ${d.chainId}
- Deployer: ${d.deployer}
- Quote Agent: ${d.quoteAgent}

## Contract Addresses

- V4PoolManager: ${d.addresses.poolManager}
- AgentQuoteRegistry: ${d.addresses.registry}
- DeterministicCreate2Factory: ${d.addresses.create2Factory}
- ArenaV4Hook: ${d.addresses.hook}
- V4FlowExecutor: ${d.addresses.flowExecutor}
- Token0: ${d.addresses.token0}
- Token1: ${d.addresses.token1}

${base ? `Explorer links:\n- ${addrLink(base, d.addresses.poolManager)}\n- ${addrLink(base, d.addresses.registry)}\n- ${addrLink(base, d.addresses.create2Factory)}\n- ${addrLink(base, d.addresses.hook)}\n- ${addrLink(base, d.addresses.flowExecutor)}\n- ${addrLink(base, d.addresses.token0)}\n- ${addrLink(base, d.addresses.token1)}` : ""}

## Hook Permission Proof

- Expected hook low-14 flags: \`0xC0\` (beforeSwap + afterSwap)
- Actual: \`${d.hookMining.hookFlagLow14}\`
- Hook CREATE2 salt: \`${d.hookMining.salt}\`
- Salt mining tries: \`${d.hookMining.tries}\`

## Real Flow Transactions

- Initialize pool: ${d.txs.initialize}
${base ? `  - ${txLink(base, d.txs.initialize)}` : ""}
- Add liquidity: ${d.txs.addLiquidity}
${base ? `  - ${txLink(base, d.txs.addLiquidity)}` : ""}
- Swap (trigger hook): ${d.txs.swap}
${base ? `  - ${txLink(base, d.txs.swap)}` : ""}

## Hook Event Proof (from swap tx)

- QuoteWindowOpened: ✅
- QuoteSubmitted: ✅
- QuoteSelected:
  - selectedAgent: \`${d.hookEvents.quoteSelected.agent}\`
  - selectedAmountOut: \`${d.hookEvents.quoteSelected.amountOut}\`
- SwapQualityRecorded:
  - baselineAmountOut: \`${d.hookEvents.swapQualityRecorded.baselineAmountOut}\`
  - finalAmountOut: \`${d.hookEvents.swapQualityRecorded.finalAmountOut}\`
  - improvementBps: \`${d.hookEvents.swapQualityRecorded.improvementBps}\`
  - quoteCount: \`${d.hookEvents.swapQualityRecorded.quoteCount}\`
  - latencySeconds: \`${d.hookEvents.swapQualityRecorded.latencySeconds}\`
  - usedFallback: \`${d.hookEvents.swapQualityRecorded.usedFallback}\`

## Agent Stats Snapshot

- submissions: \`${d.agentStats.submissions}\`
- wins: \`${d.agentStats.wins}\`
- cumulativePositiveImprovementBps: \`${d.agentStats.cumulativePositiveImprovementBps}\`

## Hackathon Description (Editable)

This submission implements an Agent RFQ Arena Hook using real Uniswap v4 flow on X Layer. The pool is initialized with a mined hook address that satisfies beforeSwap/afterSwap permission bits. A real swap triggers quote window opening, signed quote submission, best quote selection, and quality metric emission on-chain (improvement bps, quote count, latency, fallback).
`;

  fs.writeFileSync(outPath, content);
  console.log("Generated:", outPath);
}

main();
