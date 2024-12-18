import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      optimizer: {
        enabled: true,
        runs: 500,
      },
    },
  },  
  
  // To run tests
  // defaultNetwork: "hardhat",

  // To connect to smart contracts
  defaultNetwork: "harhdat",

  networks: {
    hardhat: {
      chainId: 1337,
    },

    running: {
      url: "http://localhost:8545",
      chainId: 1337,
    },
  },
};

export default config;
