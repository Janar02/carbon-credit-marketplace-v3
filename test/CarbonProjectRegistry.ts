import { expect } from "chai";
import { ethers } from "hardhat";
import { CarbonProjectRegistry } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CarbonProjectRegistry", function () {
  let projectRegistry: CarbonProjectRegistry;
  let admin: SignerWithAddress;
  let projectOwner: SignerWithAddress;
  let auditor: SignerWithAddress;
  let otherAccount: SignerWithAddress;

  const initMintPct = 90;
  const projectId = 0;
  const ipfsCID = "Qm12345exampleCID";
  const updatedIpfsCID = "Qm67890newCID"; 
  const firstVerificationId = "0000/2024";
  const secondVerificationId = "0001/2024";
  const thirdVerificationId = "0001/2024";
  const carbonRemoved = 1000000;

  //Errors
  const invalidCarbonReducedError = "InvalidReductionAmount";
  const notProjectOwnerError = "NotProjectOwner";
  const projectAuditedError = "ProjectAlreadyAudited";
  const projectExistsError = "ProjectAlreadyExists";
  const projectNotFoundError = "ProjectNotFound";
  const unauthorizedAccountError = "UnauthorizedAccount";


  async function deployCarbonProjectRegistry() {
    [admin, projectOwner, auditor, otherAccount] = await ethers.getSigners();

    // Deploy
    const CarbonProjectRegistryFactory = await ethers.getContractFactory("CarbonProjectRegistry");
    projectRegistry = await CarbonProjectRegistryFactory.deploy(initMintPct, admin.address, projectOwner.address);

    // Grant auditor role to auditor account
    await projectRegistry.connect(admin).grantRole(
      await projectRegistry.AUDITOR_ROLE(), 
      auditor.address
    );
  }

  async function addValidProject(_projectRegistry: CarbonProjectRegistry, _callerAddress: SignerWithAddress){
    return await projectRegistry.connect(_callerAddress).addProject(carbonRemoved, ipfsCID, firstVerificationId);
  }

  beforeEach(async function () {
    await deployCarbonProjectRegistry();
    addValidProject(projectRegistry, projectOwner);
  });
  
  describe("Adding a project", function(){
    it("should add a project successfully", async function () {
      const id = projectId+1;
      
      const tx = await projectRegistry.connect(projectOwner).addProject(carbonRemoved, ipfsCID, secondVerificationId);

      await expect(tx).to.emit(projectRegistry, "ProjectAdded").withArgs(projectOwner.address, id, carbonRemoved, ipfsCID);
      
      // Fetch the project details
      const project = await projectRegistry.projects(projectId);
      
      // Assert the project details
      expect(project.ipfsCID).to.equal(ipfsCID);
      expect(project.projectOwner).to.equal(projectOwner.address);
      expect(project.status).to.equal(0); // ProjectStatus.Pending
      expect(project.authenticationDate).to.equal(0); // No verification yet
      expect(project.creditsIssued).to.equal(0);
    });
  
    it("should fail when trying to add an existing project", async function () {    
      // Attempt to add the same project again
      await expect(
        addValidProject(projectRegistry, projectOwner)
      ).to.be.revertedWithCustomError(projectRegistry, projectExistsError).withArgs(firstVerificationId);
    });

    it("should fail when no carbon was reduced", async function () {
      await expect(
        projectRegistry.connect(projectOwner).addProject(
          0,
          ipfsCID,
          thirdVerificationId,
        )
      ).to.be.revertedWithCustomError(projectRegistry, invalidCarbonReducedError).withArgs(0);
    });
  })

  describe("Auditing a project", function(){
    it("should allow auditor to accept project", async function () {  
      // Update project status
      await projectRegistry.connect(auditor).acceptProject(projectId);
  
      // Fetch the updated project details
      const project = await projectRegistry.projects(projectId);
      const mintPercentage = await projectRegistry.mintPercentage();
      const correctedCreditAmount = BigInt(carbonRemoved) * BigInt(mintPercentage) / BigInt(100);
      
      // Assert the updated status and verification date
      expect(project.status).to.equal(1); // ProjectStatus.Verified
      expect(project.authenticationDate).to.be.greaterThan(0);
      expect(project.creditsIssued).to.equal(correctedCreditAmount);
    });

    it("shouldn't allow auditor to accept a non-existant project", async function () {
      const randomProjectId = 10001;

      await expect(
        projectRegistry.connect(auditor).acceptProject(randomProjectId)
      ).to.be.revertedWithCustomError(projectRegistry, projectNotFoundError);
    });

    it("should allow auditor to reject project", async function () {
      // Update project status by verifier
      await projectRegistry.connect(auditor).rejectProject(projectId);
  
      // Fetch the updated project details
      const project = await projectRegistry.projects(projectId);
      
      // Assert the updated status and verification date
      expect(project.status).to.equal(2); // ProjectStatus.Rejected
      expect(project.authenticationDate).to.be.equal(0);
      expect(project.creditsIssued).to.equal(0);
    });

    it("shouldn't allow auditor to reject a non-existant project", async function () {
      const randomProjectId = 10001;

      await expect(
        projectRegistry.connect(auditor).rejectProject(randomProjectId)
      ).to.revertedWithCustomError(projectRegistry, projectNotFoundError);
    });

    it("shouldn't allow auditor to reject an audited project", async function () {
      await projectRegistry.connect(auditor).acceptProject(projectId)

      await expect(
        projectRegistry.connect(auditor).rejectProject(projectId)
      ).to.revertedWithCustomError(projectRegistry, projectAuditedError);
    });

    it("shouldn't allow random address to accept/reject project", async function () {
      // Attempt to update status from unauthorized account
      await expect(
        projectRegistry.connect(otherAccount).acceptProject(
          projectId
        )
      ).to.be.reverted;

      await expect(
        projectRegistry.connect(otherAccount).rejectProject(
          projectId
        )
      ).to.be.reverted;
    });
  })

  describe("Updating a project", function(){
    it("should allow project owner to update info of a pending project", async function () {     
      // Update project info
      await projectRegistry.connect(projectOwner).updateProjectMetaData(
        projectId, 
        updatedIpfsCID
      );
  
      // Fetch the updated project details
      const project = await projectRegistry.projects(projectId);
      
      // Assert the updated details
      expect(project.ipfsCID).to.equal(updatedIpfsCID);
      expect(project.status).to.equal(0); // ProjectStatus.Pending
    });

    it("should allow project owner to update info of a rejected project", async function () {
      // First, update status to Rejected
      await projectRegistry.connect(auditor).rejectProject(
        projectId
      );
  
      // Then update project info
      await projectRegistry.connect(projectOwner).updateProjectMetaData(
        projectId, 
        updatedIpfsCID
      );
  
      // Fetch the updated project details
      const project = await projectRegistry.projects(projectId);
      
      // Assert the updated details
      expect(project.ipfsCID).to.equal(updatedIpfsCID);
      expect(project.status).to.equal(0); // ProjectStatus.Pending
    });

    it("shouldn't allow non project owner to update project", async function () {
      await projectRegistry.grantRole(await projectRegistry.PROJECT_OWNER_ROLE(), otherAccount.address);
      await expect( 
        projectRegistry.connect(otherAccount).updateProjectMetaData(
          projectId, 
          updatedIpfsCID
        )
      ).to.revertedWithCustomError(projectRegistry, notProjectOwnerError);
    });

    it("shouldn't allow project owner to update audited project", async function () {
      await projectRegistry.connect(auditor).acceptProject(projectId);

      await expect( 
        projectRegistry.connect(projectOwner).updateProjectMetaData(
          projectId, 
          updatedIpfsCID
        )
      ).to.revertedWithCustomError(projectRegistry, projectAuditedError);
    });
  })
});