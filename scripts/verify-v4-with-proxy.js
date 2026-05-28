const { spawn } = require("child_process");

const proxy = process.env.VERIFY_PROXY_URL || "http://127.0.0.1:7890";
const env = {
  ...process.env,
  // hardhat-verify's undici integration reads lowercase http_proxy.
  http_proxy: process.env.http_proxy || proxy,
  https_proxy: process.env.https_proxy || proxy,
  HTTP_PROXY: process.env.HTTP_PROXY || proxy,
  HTTPS_PROXY: process.env.HTTPS_PROXY || proxy
};

const child = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["hardhat", "run", "scripts/verify-v4-deployed.js", "--network", "xlayerTestnet"],
  {
    stdio: "inherit",
    env
  }
);

child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
