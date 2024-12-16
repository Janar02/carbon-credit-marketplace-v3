import { expect } from "chai";
import { ethers } from "hardhat";
import { CarbonCreditToken, CarbonProjectRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CarbonCreditToken", function() {
  let projectRegistry: CarbonProjectRegistry;
  let carbonToken: CarbonCreditToken;
  let admin: SignerWithAddress;
  let projectOwner: SignerWithAddress;
  let tokenManager: SignerWithAddress;
  let otherAccount: SignerWithAddress;

  const creditsMintedEvent = "CreditsMinted";
  const creditsMintedbatchEvent = "CreditsMintedBatch";

  const projectNotFoundError = "ProjectNotFound";
  const exceededMintAountError = "MintExceedsIssuedCredits";

  const initMintPct = 90;
  const projectId = 0;
  const ipfsCID = "Qm12345exampleCID";
  const uniqueVerificationId = "0000/2024";
  const carbonRemoved = 100000;

  async function deployContracts() {
    [admin, projectOwner, tokenManager, otherAccount] = await ethers.getSigners();
    const CarbonProjectRegistryFactory = await ethers.getContractFactory("CarbonProjectRegistry");
    projectRegistry = await CarbonProjectRegistryFactory.deploy(
      initMintPct,
      admin.address, 
      projectOwner.address
    );

    const CarbonCreditTokenFactory = await ethers.getContractFactory("CarbonCreditToken");
    carbonToken = await CarbonCreditTokenFactory.deploy(
      admin.address, 
      admin.address, 
      projectRegistry.getAddress()
    );

    await carbonToken.connect(admin).grantRole(
      await carbonToken.TOKEN_MANAGER_ROLE(), 
      tokenManager.address
    );
  }

  beforeEach(async function () {
    await deployContracts();
    // Add and accept a project for testing
    await projectRegistry.connect(projectOwner).addProject(
      carbonRemoved,
      ipfsCID,
      uniqueVerificationId
    );
    await projectRegistry.connect(admin).acceptProject(projectId);
  })

  describe("Minting", function() {
    it("Should successfully mint tokens for a project", async function () {
      const creditsIssued = await projectRegistry.getProjectIssuedCredits(projectId);

      
      // mint some credits
      const firstMint = creditsIssued / BigInt(2);
      
      const tx1 = await carbonToken.connect(tokenManager).mintCredits(
        projectOwner.address, 
        projectId, 
        firstMint, 
        "0x"
      );

      await expect(tx1).to.emit(carbonToken, creditsMintedEvent).withArgs(projectOwner.address, projectId, firstMint);
      
      const balanceFirst = await carbonToken.balanceOf(projectOwner.address, projectId);
      expect(balanceFirst).to.equal(firstMint);

      const secondMint = creditsIssued / BigInt(4);

      const tx2 = await carbonToken.connect(tokenManager).mintCredits(
        projectOwner.address, 
        projectId, 
        secondMint, 
        "0x"
      );

      await expect(tx2).to.emit(carbonToken, creditsMintedEvent).withArgs(projectOwner.address, projectId, secondMint);
      
      const balanceSecond = await carbonToken.balanceOf(projectOwner.address, projectId);
      expect(balanceSecond).to.equal(firstMint+secondMint);
    });

    it("Should revert minting for non-existent project", async function () {
      const nonExistentProjectId = 9999;
      
      await expect(
        carbonToken.connect(tokenManager).mintCredits(
          projectOwner.address, 
          nonExistentProjectId, 
          100, 
          "0x"
        )
      ).to.be.revertedWithCustomError(carbonToken, projectNotFoundError);
    });

    it("Should revert minting more credits than issued", async function () {
      const creditsIssued = await projectRegistry.getProjectIssuedCredits(projectId);
      
      await carbonToken.connect(tokenManager).mintCredits(
        projectOwner.address, 
        projectId, 
        creditsIssued - BigInt(2), 
        "0x"
      )

      await expect(
        carbonToken.connect(tokenManager).mintCredits(
          projectOwner.address, 
          projectId, 
          3, 
          "0x"
        )
      ).to.be.revertedWithCustomError(carbonToken, exceededMintAountError);
    });

    it("Should revert minting by non-token-manager", async function () {
      const creditsIssued = await projectRegistry.getProjectIssuedCredits(projectId);
      
      await expect(
        carbonToken.connect(otherAccount).mintCredits(
          projectOwner.address, 
          projectId, 
          creditsIssued, 
          "0x"
        )
      ).to.be.reverted;
    });
  });

  describe("Batch Minting", function() {
    it("Should successfully mint tokens for multiple projects", async function () {
      // Add another project
      await projectRegistry.connect(projectOwner).addProject(
        carbonRemoved,
        "AnotherIPFSCID",
        "0001/2024"
      );
      await projectRegistry.connect(admin).acceptProject(1);

      const ids: [number,number] = [0,1];
      
      const creditsProject0 = await projectRegistry.getProjectIssuedCredits(ids[0]);
      const creditsProject1 = await projectRegistry.getProjectIssuedCredits(ids[1]);
      
      const amounts = [creditsProject0, creditsProject1]; 
      
      // Mint credits from both projects
      const tx = await carbonToken.connect(tokenManager).mintCreditsBatch(
        projectOwner.address, 
        ids, 
        amounts, 
        "0x"
      );

      // check event emission
      await expect(tx).to.emit(carbonToken, creditsMintedbatchEvent);

      const balances = await carbonToken.balanceOfBatch(
        [projectOwner.address, projectOwner.address], 
        ids
      );

      // Check balances after emission
      expect(balances[0]).to.equal(creditsProject0);
      expect(balances[1]).to.equal(creditsProject1);
    });

    it("Should revert batch minting with mismatched array lengths", async function () {
      await expect(
        carbonToken.connect(tokenManager).mintCreditsBatch(
          projectOwner.address, 
          [0, 1], 
          [100], 
          "0x"
        )
      ).to.be.revertedWithCustomError(carbonToken, "MismatchingArrayLengths");
    });
  });

  describe("Retiring Credits", function() {
    it("Should successfully retire credits", async function () {
      const creditsIssued = await projectRegistry.getProjectIssuedCredits(projectId);
      
      // Mint credits
      await carbonToken.connect(tokenManager).mintCredits(
        projectOwner.address, 
        projectId, 
        creditsIssued, 
        "0x"
      );

      // Retire some credits
      const retireAmount = creditsIssued / BigInt(2);
      const description = "Carbon offset retirement";

      const tx = await carbonToken.connect(projectOwner).retireCredits(
        projectId, 
        retireAmount, 
        description
      );

      // Check balance after retirement
      const balance = await carbonToken.balanceOf(projectOwner.address, projectId);
      expect(balance).to.equal(creditsIssued - retireAmount);

      // Check event emission
      await expect(tx)
        .to.emit(carbonToken, "CreditRetired")
        .withArgs(
          projectOwner.address, 
          projectId, 
          retireAmount, 
          await ethers.provider.getBlock('latest').then(block => block?.timestamp),
          description
        );
    });

    it("Should revert retiring credits with insufficient balance", async function () {
      await expect(
        carbonToken.connect(projectOwner).retireCredits(
          projectId, 
          100, 
          "Test retirement"
        )
      ).to.be.revertedWithCustomError(carbonToken, "InsufficientBalance");
    });
  });
});