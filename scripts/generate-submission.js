const fs = require("fs");
const path = require("path");

function readJSON(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function latestDeploymentPath(networkName) {
  const deploymentsDir = path.join(process.cwd(), "deployments");
  const p = path.join(deploymentsDir, `${networkName}-latest.json`);
  if (!fs.existsSync(p)) {
    throw new Error(`Deployment file not found: ${p}`);
  }
  return p;
}

function explorerBase(networkName) {
  if (networkName === "xlayer") {
    return "https://www.oklink.com/xlayer/address/";
  }
  if (networkName === "xlayerTestnet") {
    return "https://www.oklink.com/xlayer-test/address/";
  }
  return "";
}

function main() {
  const networkName = process.env.DEPLOYMENT_NETWORK || "xlayerTestnet";
  const deploymentFile = process.env.DEPLOYMENT_FILE || latestDeploymentPath(networkName);
  const deployment = readJSON(deploymentFile);

  const submissionsDir = path.join(process.cwd(), "submissions");
  fs.mkdirSync(submissionsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outFile = path.join(submissionsDir, `submission-${deployment.network}-${stamp}.md`);
  const explorer = explorerBase(deployment.network);

  const content = `# Hook Hackathon Submission Draft

Generated at: ${new Date().toISOString()}

## Basic Info

- Network: ${deployment.network}
- Chain ID: ${deployment.chainId}
- Deployer: ${deployment.deployer}
- Generated from deployment file: \`${path.basename(deploymentFile)}\`

## Contract Addresses

- AgentQuoteRegistry: ${deployment.registryAddress}
${explorer ? `- Explorer: ${explorer}${deployment.registryAddress}` : ""}
- ArenaHook: ${deployment.hookAddress}
${explorer ? `- Explorer: ${explorer}${deployment.hookAddress}` : ""}

## Constructor Arguments

- AgentQuoteRegistry(owner): \`${deployment.deployer}\`
- ArenaHook(registryAddress, directSettleThreshold):
  - registryAddress: \`${deployment.registryAddress}\`
  - directSettleThreshold: \`${deployment.directSettleThreshold}\`

## Whitelisted Agents

${deployment.whitelistedAgents.length ? deployment.whitelistedAgents.map((a) => `- ${a}`).join("\n") : "- (none)"}

## Checklist Before Form Submit

- [ ] Contract source verified
- [ ] Demo video URL ready
- [ ] X/Twitter progress thread URL ready
- [ ] README updated with deployed addresses
- [ ] Google Form fields filled

## Suggested Form Description (editable)

This project implements an Agent RFQ Arena Hook on X Layer. Users open a quote window before swap settlement, multiple whitelisted agents submit signed quotes, and the hook selects the best executable quote while recording on-chain quality metrics (improvement bps, quote count, latency, fallback usage). The architecture includes a dedicated AgentQuoteRegistry for whitelist and performance stats.
`;

  fs.writeFileSync(outFile, content);
  console.log("Submission draft generated:", outFile);
}

main();
