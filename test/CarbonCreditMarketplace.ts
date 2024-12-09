import { expect } from "chai";
import { ethers } from "hardhat";
import { 
  CarbonCreditMarketplace, 
  CarbonCreditToken, 
  CarbonProjectRegistry 
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("CarbonCreditMarketplace", function () {
  let marketplace: CarbonCreditMarketplace;
  let carbonToken: CarbonCreditToken;
  let projectRegistry: CarbonProjectRegistry;
  
  let owner: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let auditor: SignerWithAddress;

  // Project and credit details
  const initMintPct = 90;
  const projectId = 0;
  const ipfsCID = "Qm12345exampleCID";
  const uniqueVerificationId = "0000/2024";
  const carbonRemoved = 500000;

  // Deployment helper function
  async function deployContracts() {
    [owner, seller, buyer, auditor] = await ethers.getSigners();

    // Deploy Project Registry
    const ProjectRegistryFactory = await ethers.getContractFactory("CarbonProjectRegistry");
    projectRegistry = await ProjectRegistryFactory.deploy(initMintPct, owner.address, seller.address);

    // Deploy Carbon Credit Token
    const CarbonTokenFactory = await ethers.getContractFactory("CarbonCreditToken");
    carbonToken = await CarbonTokenFactory.deploy(
      owner.address, 
      owner.address, 
      await projectRegistry.getAddress()
    );

    // Deploy Marketplace
    const MarketplaceFactory = await ethers.getContractFactory("CarbonCreditMarketplace");
    marketplace = await MarketplaceFactory.deploy(
      await carbonToken.getAddress(), 
      await projectRegistry.getAddress(), 
      owner.address
    );
    
    // Add project as seller
    await projectRegistry.connect(seller).addProject(
      carbonRemoved,
      ipfsCID,
      uniqueVerificationId, 
    );

    // Approve and mint credits by auditor
    await projectRegistry.connect(owner).grantRole(
      await projectRegistry.AUDITOR_ROLE(), 
      auditor.address
    );
    await projectRegistry.connect(auditor).acceptProject(projectId);
    const toBeMinted = await projectRegistry.getProjectIssuedCredits(projectId);

    // Mint tokens to seller
    await carbonToken.connect(owner).mintCredits(seller.address, projectId, toBeMinted, "0x");

    return { marketplace, carbonToken, projectRegistry };
  }

  beforeEach(async function () {
    await deployContracts();
  });

  describe("Order Creation", function () {
    it("Should allow creating a sell order for valid carbon credits", async function () {
      // Approve marketplace to spend tokens
      await carbonToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      // Create sell order
      await expect(
        marketplace.connect(seller).createSellOrder(
          projectId, 
          300, 
          ethers.parseEther("0.1") // 0.1 ETH per credit
        )
      ).to.emit(marketplace, "OrderCreated")
        .withArgs(
          1, // First order ID
          seller.address, 
          projectId, 
          300,
          ethers.parseEther("0.1")
        );

      // Verify order details
      const order = await marketplace.tradeOrders(1);
      expect(order.seller).to.equal(seller.address);
      expect(order.projectId).to.equal(projectId);
      expect(order.totalAmount).to.equal(300);
      expect(order.remainingAmount).to.equal(300);
      expect(order.isActive).to.be.true;
    });

    it("Should prevent creating an order for non-existent or non-audited project", async function () {
      await expect(
        marketplace.connect(seller).createSellOrder(
          999, // Non-existent project ID
          300, 
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWith("Invalid or non-audited project");
    });

    it("Should prevent creating an order with insufficient token balance", async function () {
      await carbonToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

    //   const sellerBalance = await carbonToken.balanceOf(seller.address, projectId);
    //   console.log(sellerBalance);  

      await expect(
        marketplace.connect(seller).createSellOrder(
          projectId, 
          carbonRemoved, // More than seller's balance
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWith("Insufficient token balance");
    });
  });

  describe("Trade Execution", function () {
    let orderId: bigint;

    beforeEach(async function () {
      // Approve marketplace to spend tokens
      await carbonToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      // Create sell order
      await marketplace.connect(seller).createSellOrder(
        projectId, 
        300, 
        ethers.parseEther("0.1")
      );
      orderId = 1n;
    });

    it("Should execute a full trade successfully", async function () {
      const initialSellerBalance = await ethers.provider.getBalance(seller.address);
      const tradeAmount = 300;
      const totalPrice = tradeAmount * Number(ethers.parseEther("0.1"));

      await expect(
        marketplace.connect(buyer).executeTrade(orderId, tradeAmount, {
          value: ethers.parseEther(String(totalPrice / 1e18))
        })
      ).to.emit(marketplace, "OrderFullyExecuted")
        .withArgs(orderId, buyer.address);

      // Verify token transfer
      const buyerBalance = await carbonToken.balanceOf(buyer.address, projectId);
      expect(buyerBalance).to.equal(tradeAmount);

      // Verify seller received payment
      const finalSellerBalance = await ethers.provider.getBalance(seller.address);
      expect(finalSellerBalance).to.equal(initialSellerBalance + BigInt(totalPrice));
    });

    it("Should allow partial order fills", async function () {
      const partialAmount = BigInt(100);
      const totalPrice = partialAmount * BigInt(Number(ethers.parseEther("0.1")));

      await expect(
        marketplace.connect(buyer).executeTrade(orderId, partialAmount, {
          value: ethers.parseEther(String(totalPrice / BigInt(1e18)))
        })
      ).to.emit(marketplace, "PartialOrderFilled")
        .withArgs(
          orderId, 
          buyer.address, 
          seller.address,
          partialAmount, 
          totalPrice
        );

      // Check remaining amount
      const order = await marketplace.tradeOrders(orderId);
      expect(order.remainingAmount).to.equal(200);
    });

    it("Should prevent trading more credits than available", async function () {
      await expect(
        marketplace.connect(buyer).executeTrade(orderId, 400, {
          value: ethers.parseEther("40")
        })
      ).to.be.revertedWith("Requested amount exceeds available credits");
    });

    it("Should prevent trading on an inactive order", async function () {
      // Cancel the order first
      await marketplace.connect(seller).cancelSellOrder(orderId);

      await expect(
        marketplace.connect(buyer).executeTrade(orderId, 100, {
          value: ethers.parseEther("10")
        })
      ).to.be.revertedWith("Order is not active");
    });
  });

  describe("Order Cancellation", function () {
    let orderId: bigint;

    beforeEach(async function () {
      // Approve marketplace to spend tokens
      await carbonToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

      // Create sell order
      await marketplace.connect(seller).createSellOrder(
        projectId, 
        300, 
        ethers.parseEther("0.1")
      );
      orderId = 1n;
    });

    it("Should allow order owner to cancel their order", async function () {
      await expect(
        marketplace.connect(seller).cancelSellOrder(orderId)
      ).to.emit(marketplace, "OrderCancelled")
        .withArgs(orderId);

      // Verify order is inactive
      const order = await marketplace.tradeOrders(orderId);
      expect(order.isActive).to.be.false;
    });

    it("Should prevent non-owners from cancelling an order", async function () {
      await expect(
        marketplace.connect(buyer).cancelSellOrder(orderId)
      ).to.be.revertedWith("Not order owner");
    });
  });
});