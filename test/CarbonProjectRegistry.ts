import { expect } from "chai";
import { ethers } from "hardhat";
import { CarbonProjectRegistry } from "../typechain-types";

describe("CarbonProjectRegistry", function () {
  const projectId = 0;
  const ipfsCID = "Qm12345exampleCID";
  const projectName = "Example Project";
  const uniqueVerificationId = "0000/2024";
  const verifyingBodyNr = 0; // VCS aka Verra verifier
  const carbonRemoved = 1000000;
  const creditAmount = 1000;

  async function deployCarbonProjectRegistry() {
    const [admin, projectOwner, auditor, otherAccount] = await ethers.getSigners();
    const CarbonProjectRegistryFactory = await ethers.getContractFactory("CarbonProjectRegistry");
    const carbonProjectRegistry = await CarbonProjectRegistryFactory.deploy(
      admin.address, 
      projectOwner.address
    ) as CarbonProjectRegistry;

    // Grant verifier role to verifier account
    await carbonProjectRegistry.connect(admin).grantRole(
      await carbonProjectRegistry.AUDITOR_ROLE(), 
      auditor.address
    );

    return { carbonProjectRegistry, projectOwner, verifier: auditor, otherAccount}
  }
  
  describe("Adding a project", function(){
    // Test 1
    it("should add a project successfully", async function () {
      const {carbonProjectRegistry, projectOwner} = await deployCarbonProjectRegistry();
  
      const verifyingBody = await carbonProjectRegistry.convertToVerificationBody(verifyingBodyNr);

      // Call addProject from the projectOwner account
      await carbonProjectRegistry.connect(projectOwner).addProject(
        ipfsCID, 
        projectName,
        carbonRemoved,
        uniqueVerificationId,
        verifyingBody
      );
      
      // Fetch the project details
      const project = await carbonProjectRegistry.projects(projectId);
      
      // Assert the project details
      expect(project.ipfsCID).to.equal(ipfsCID);
      expect(project.projectName).to.equal(projectName);
      expect(project.projectOwner).to.equal(projectOwner.address);
      expect(project.status).to.equal(0); // ProjectStatus.Pending
      expect(project.authenticationDate).to.equal(0); // No verification yet
      expect(project.creditsIssued).to.equal(0);
    });
  
    // Test 2
    it("should fail when trying to add an existing project", async function () {
      const {carbonProjectRegistry, projectOwner} = await deployCarbonProjectRegistry();
  
      const verifyingBody = await carbonProjectRegistry.convertToVerificationBody(verifyingBodyNr);

      // Add the project for the first time
      await carbonProjectRegistry.connect(projectOwner).addProject(
        ipfsCID, 
        projectName, 
        carbonRemoved,
        uniqueVerificationId,
        verifyingBody
      );
      
      // Attempt to add the same project again
      await expect(
        carbonProjectRegistry.connect(projectOwner).addProject(
          ipfsCID, 
          projectName, 
          carbonRemoved,
          uniqueVerificationId,
          verifyingBody
        )
      ).to.be.revertedWith("This project already exists!");
    });
  })

  describe("Updating a project", function(){
    // Test 3
    it("should allow verifier to accept project", async function () {
      const {carbonProjectRegistry, projectOwner, verifier} = await deployCarbonProjectRegistry();
  
      const verifyingBody = await carbonProjectRegistry.convertToVerificationBody(verifyingBodyNr);

      // Add the project
      await carbonProjectRegistry.connect(projectOwner).addProject(
        ipfsCID, 
        projectName, 
        carbonRemoved,
        uniqueVerificationId,
        verifyingBody
      );
  
      // Update project status by verifier
      await carbonProjectRegistry.connect(verifier).acceptProject(projectId);
  
      // Fetch the updated project details
      const project = await carbonProjectRegistry.projects(projectId);
      const riskBuffer = await carbonProjectRegistry.creditRiskBuffer();
      const correctedCreditAmount = BigInt(carbonRemoved) - (BigInt(carbonRemoved) * BigInt(riskBuffer)) / BigInt(100);
      
      // Assert the updated status and verification date
      expect(project.status).to.equal(1); // ProjectStatus.Verified
      expect(project.authenticationDate).to.be.greaterThan(0);
      expect(project.creditsIssued).to.equal(correctedCreditAmount);
    });

    // Test 4
    it("should allow project owner to update project info when rejected", async function () {
      const updatedIpfsCID = "Qm67890newCID";
      const {carbonProjectRegistry, projectOwner, verifier} = await deployCarbonProjectRegistry();
  
      const verifyingBody = await carbonProjectRegistry.convertToVerificationBody(verifyingBodyNr);
      
      // Add the project
      await carbonProjectRegistry.connect(projectOwner).addProject(
        ipfsCID, 
        projectName, 
        carbonRemoved,
        uniqueVerificationId,
        verifyingBody
      );
  
      // First, update status to Rejected by verifier
      await carbonProjectRegistry.connect(verifier).rejectProject(
        projectId
      );
  
      // Then update project info by project owner
      await carbonProjectRegistry.connect(projectOwner).updateProjectMetaData(
        projectId, 
        updatedIpfsCID
      );
  
      // Fetch the updated project details
      const project = await carbonProjectRegistry.projects(projectId);
      
      // Assert the updated details
      expect(project.ipfsCID).to.equal(updatedIpfsCID);
      expect(project.status).to.equal(0); // ProjectStatus.Pending
    });
    // Test 5
    it("should prevent non-verifier from updating project status", async function () {
      const {carbonProjectRegistry, projectOwner, otherAccount} = await deployCarbonProjectRegistry();
  
      const verifyingBody = await carbonProjectRegistry.convertToVerificationBody(verifyingBodyNr);

      // Add the project
      await carbonProjectRegistry.connect(projectOwner).addProject(
        ipfsCID, 
        projectName, 
        carbonRemoved,
        uniqueVerificationId,
        verifyingBody
      );  
      // Attempt to update status by non-verifier
      await expect(
        carbonProjectRegistry.connect(otherAccount).acceptProject(
          projectId
        )
      ).to.be.reverted; // This will check for AccessControl's revert
    });
  })
});