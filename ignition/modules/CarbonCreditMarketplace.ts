import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const CarbonCreditsDeploymentModule = buildModule("CarbonCreditsDeployment", (m) => {
  // Deploy CarbonProjectRegistry first
  const defaultAdmin = m.getAccount(0);
  const defaultProjectOwner = m.getAccount(1);
  const mintPercentage = m.getParameter("mintPercentage", 10); // Default to 10% if not specified

  const carbonProjectRegistry = m.contract("CarbonProjectRegistry", [
    mintPercentage,
    defaultAdmin,
    defaultProjectOwner
  ]);

  // Deploy CarbonCreditToken 
  const tokenManager = m.getAccount(2);

  const carbonCreditToken = m.contract("CarbonCreditToken", [
    defaultAdmin,
    tokenManager,
    carbonProjectRegistry // Pass the deployed registry address
  ]);

  // Deploy CarbonCreditMarketplace
  const initialOwner = m.getAccount(3);

  const carbonCreditMarketplace = m.contract("CarbonCreditMarketplace", [
    carbonCreditToken,
    carbonProjectRegistry,
    initialOwner
  ]);

  return { 
    carbonProjectRegistry, 
    carbonCreditToken, 
    carbonCreditMarketplace 
  };
});

export default CarbonCreditsDeploymentModule;