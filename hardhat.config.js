require("@nomicfoundation/hardhat-toolbox");
require("@nomiclabs/hardhat-ethers");
require("hardhat-contract-sizer");
require("dotenv").config();

/**
 * Load up to 6 private keys from .env
 * PRIVATE_KEY, PRIVATE_KEY_2, ... PRIVATE_KEY_6
 */
const PKS = [
  process.env.PRIVATE_KEY,
  process.env.PRIVATE_KEY_2,
  process.env.PRIVATE_KEY_3,
  process.env.PRIVATE_KEY_4,
  process.env.PRIVATE_KEY_5,
  process.env.PRIVATE_KEY_6,
].filter(Boolean);

// Hardhat node needs objects { privateKey, balance } to pre-fund/unlock them
const HARDHAT_ACCOUNTS = PKS.map((pk) => ({
  privateKey: pk.startsWith("0x") ? pk : `0x${pk}`,
  balance: "10000000000000000000000", // 10,000 ETH
}));

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.17",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      metadata: { bytecodeHash: "none" },
      debug: { revertStrings: "strip" },
    },
  },
  contractSizer: {
    runOnCompile: true,
    disambiguatePaths: false,
  },
  networks: {
    // IMPORTANT: This config is used when you run `npx hardhat node`
    // It boots the local chain with YOUR 6 keys, preloaded with fake ETH.
    hardhat: {
      chainId: 31337,
      mining: { auto: true, interval: 0 },
      blockGasLimit: 30_000_000,
      allowUnlimitedContractSize: true,
      accounts: HARDHAT_ACCOUNTS.length
        ? HARDHAT_ACCOUNTS
        : undefined, // fallback to defaults if you didn't provide keys
    },

    // When you run scripts with `--network localhost`, Hardhat will sign with these same keys.
    // (Note: The *node’s* unlocked accounts still come from the `hardhat` section above.)
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
      timeout: 60_000,
      accounts: PKS.length
        ? PKS.map((pk) => (pk.startsWith("0x") ? pk : `0x${pk}`))
        : undefined,
    },

    // Sepolia uses the same keys (you can keep just one or add more if you like)
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL,
      accounts: PKS.length
        ? PKS.map((pk) => (pk.startsWith("0x") ? pk : `0x${pk}`))
        : [],
      // optional gas controls if needed:
      // gasPrice: "auto",
      // gas: "auto",
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
    gasPrice: 20,
    coinmarketcap: process.env.COINMARKETCAP_API_KEY,
  },
  etherscan: {
    apiKey: {
      sepolia: process.env.ETHERSCAN_API_KEY,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  mocha: {
    timeout: 40000,
    reporter: "spec",
  },
};
