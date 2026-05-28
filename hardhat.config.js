require("@nomicfoundation/hardhat-ethers");
require("@nomicfoundation/hardhat-chai-matchers");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const XLAYER_MAINNET_RPC_URL = process.env.XLAYER_MAINNET_RPC_URL || "";
const XLAYER_TESTNET_RPC_URL = process.env.XLAYER_TESTNET_RPC_URL || "";
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const normalizedPrivateKey = DEPLOYER_PRIVATE_KEY
  ? (DEPLOYER_PRIVATE_KEY.startsWith("0x") ? DEPLOYER_PRIVATE_KEY : `0x${DEPLOYER_PRIVATE_KEY}`)
  : "";

const accounts = normalizedPrivateKey ? [normalizedPrivateKey] : [];

module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.24",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      {
        version: "0.8.26",
        settings: {
          evmVersion: "cancun",
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ]
  },
  networks: {
    xlayer: {
      url: XLAYER_MAINNET_RPC_URL,
      chainId: 196,
      accounts
    },
    xlayerTestnet: {
      url: XLAYER_TESTNET_RPC_URL,
      chainId: 1952,
      accounts
    }
  },
  etherscan: {
    apiKey: {
      xlayer: "empty",
      xlayerTestnet: "empty"
    },
    customChains: [
      {
        network: "xlayer",
        chainId: 196,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER",
          browserURL: "https://www.oklink.com/xlayer"
        }
      },
      {
        network: "xlayerTestnet",
        chainId: 1952,
        urls: {
          apiURL: "https://www.oklink.com/api/v5/explorer/contract/verify-source-code-plugin/XLAYER_TESTNET",
          browserURL: "https://www.oklink.com/xlayer-test"
        }
      }
    ]
  }
};
