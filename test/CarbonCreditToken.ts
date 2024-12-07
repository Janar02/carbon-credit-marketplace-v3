import { expect } from "chai";
import { ethers } from "hardhat";
import { CarbonCreditToken, CarbonProjectRegistry } from "../typechain-types";

describe("CarbonCreditToken", function() {
    const projectId = 0;
    const ipfsCID = "Qm12345exampleCID";
    const projectName = "Example Project";
    const uniqueVerificationId = "0000/2024";
    const verifyingBodyNr = 0; // VCS aka Verra verifier
    const carbonRemoved = 100000;
    const creditAmount = 1000;

    async function deployCarbonProjectRegistry() {
        const [admin, projectOwner] = await ethers.getSigners();
        const CarbonProjectRegistryFactory = await ethers.getContractFactory("CarbonProjectRegistry");
        const carbonProjectRegistry = await CarbonProjectRegistryFactory.deploy(
            admin.address, 
            projectOwner.address
        ) as CarbonProjectRegistry;

        return {carbonProjectRegistry, admin, projectOwner}
    }
    async function deployCarbonCreditToken() {
        const {carbonProjectRegistry, admin, projectOwner} = await deployCarbonProjectRegistry();
        const CarbonCreditTokenFactory = await ethers.getContractFactory("CarbonCreditToken");
        const carbonCreditToken = await CarbonCreditTokenFactory.deploy(
            admin.address, 
            admin.address, 
            carbonProjectRegistry.getAddress()
        ) as CarbonCreditToken;

        return {carbonCreditToken, carbonProjectRegistry, admin, projectOwner}
    }

    describe("Minting", function() {
        // Test 1
        it("Should succesfully mint tokens for project", async function () {
            const {carbonCreditToken, carbonProjectRegistry, admin, projectOwner} = await deployCarbonCreditToken();

            const verifyingBody = await carbonProjectRegistry.convertToVerificationBody(verifyingBodyNr);

            // Call addProject from the projectOwner account
            await carbonProjectRegistry.connect(projectOwner).addProject(
                ipfsCID, 
                projectName, 
                carbonRemoved,
                uniqueVerificationId,
                verifyingBody
            );
            
            // Accept project so we can mint tokens for it
            await carbonProjectRegistry.connect(admin).acceptProject(projectId);
            
            // Get amount to mint
            const credistIssued = await carbonProjectRegistry.connect(admin).getProjectIssuedCredits(projectId);
            
            // Mint credits
            await carbonCreditToken.connect(admin).mintCredits(projectOwner, projectId, credistIssued, "0x");
            const balance = await carbonCreditToken.balanceOf(projectOwner, projectId);

            expect(balance).to.equal(credistIssued);
        })
    });
});