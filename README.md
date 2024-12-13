
npm install -> installs all required packages

# How to run the contracts
NB! If you are using Windows it is strongly recommended to use WSL for hardhat

1) Compiling

npx hardhat compile -> compiles the contracts and generates typechain-types

2) Testing

    npx hardhat test -> runs all the tests 

Example on how to run only one test
   npx hardhat test test/CarbonCreditMarketplace.ts 

3) Deploying (Does not work currently)
    TODO: Generate deploy files for contracts inside ignition/model


# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a Hardhat Ignition module that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat ignition deploy ./ignition/modules/Lock.ts
```
