import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      viaIR: true,
    },
  },
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    hardhat: {
      chainId: 31337,
      mining: {
        auto: true,
        interval: 0,
      },
      accounts: {
        mnemonic: "test test test test test test test test test test test junk",
        path: "m/44'/60'/0'/0",
        initialIndex: 0,
        count: 20,
        accountsBalance: "10000000000000000000000", // 10000 ETH
      },
      // Enable JSON-RPC server with CORS for MetaMask/Rabby
      allowUnlimitedContractSize: false,
      loggingEnabled: false,
      blockGasLimit: 30000000,
      gas: "auto",
      gasPrice: "auto",
      gasMultiplier: 1,
    },
  },
  defaultNetwork: "hardhat",
};

export default config;
