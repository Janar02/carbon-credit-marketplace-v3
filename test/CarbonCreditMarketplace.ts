import { expect } from "chai";
import { ethers } from "hardhat";
import { 
  CarbonCreditMarketplace, 
  CarbonCreditToken, 
  CarbonProjectRegistry 
} from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { bigint } from "hardhat/internal/core/params/argumentTypes";

describe("CarbonCreditMarketplace", function () {
  let marketplace: CarbonCreditMarketplace;
  let carbonToken: CarbonCreditToken;
  let projectRegistry: CarbonProjectRegistry;
  
  let owner: SignerWithAddress;
  let seller: SignerWithAddress;
  let buyer: SignerWithAddress;
  let auditor: SignerWithAddress;

  const orderCreatedEvent = "OrderCreated";
  const orderClosedEvent = "OrderClosed";
  const orderExpiredEvent = "OrderExpired";
  const orderNotExpiredEvent = "OrderNotExpired";
  const togglePauseEvent = "MarketplacePauseStatusChanged";
  const updateFeeEvent = "PlatformFeeUpdated";

  const insufficientBalanceError = "InsufficientBalance";
  const inactiveOrderError = "InactiveOrder";
  const invalidPriceError = "InvalidPrice";
  const notOrderOwnerError = "NotOrderOwner";
  const transferNotApprocedError = "TransferNotApproved";


  // Project and credit details
  const initMintPct = 90;
  const projectId = 0;
  const ipfsCID = "Qm12345exampleCID";
  const uniqueVerificationId = "0000/2024";
  const carbonRemoved = 500000;

  const SEVEN_DAYS = 7*24*60*60;

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
  }

  beforeEach(async function () {
    await deployContracts();     
    // Approve marketplace contract to spend tokens on sellers account
    await carbonToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);
  });

  describe("Editing Market Variables", function(){
    it("Should allow contract owner to pause market", async function () {
      let marketplacePaused = await marketplace.marketplacePaused();
      expect(marketplacePaused).to.be.false;
      const tx = await marketplace.connect(owner).toggleMarketplacePause();
      expect(tx).to.emit(marketplace, togglePauseEvent).withArgs(true);
      marketplacePaused =  await marketplace.marketplacePaused();
      expect(marketplacePaused).to.be.true;
    });

    it("Should allow contract owner to update market fee", async function () {
      const initialFee = 120;
      const newFee = 130;
      let marketFee = await marketplace.platformFeeBasisPoints();
      expect(marketFee).to.equal(initialFee);
      await expect(
        marketplace.updatePlatformFee(newFee)
      ).to.emit(marketplace, updateFeeEvent).withArgs(newFee);

      marketFee = await marketplace.platformFeeBasisPoints();
      expect(marketFee).to.equal(newFee); //
    });
  });

  describe("Order Creation", function () {
    it("Should allow creating a sell order for valid carbon credits", async function () {
      const creditAmount = 300;
      const pricePerCredit = ethers.parseEther("0.1"); // 0.1 ETH per credit

      const sellerInitBalance = await carbonToken.balanceOf(seller.address, projectId);
      const contractInitBalance = await carbonToken.balanceOf(marketplace.getAddress(), projectId);

      // Create sell order
      const tx = await marketplace.connect(seller).createSellOrder(
        projectId, 
        creditAmount, 
        pricePerCredit // Order price on nagu nimetus kogu orderi pricele mitte uniti price
      );
      const firstOrderId = 0;
      await expect(tx).to.emit(marketplace, orderCreatedEvent).withArgs(firstOrderId, seller.address, projectId, creditAmount, BigInt(creditAmount)*pricePerCredit)

      // Verify order details
      const order = await marketplace.tradeOrders(firstOrderId);
      const timestamp = await ethers.provider.getBlock('latest').then(block => block!.timestamp);
      expect(order.seller).to.equal(seller.address);
      expect(order.projectId).to.equal(projectId);
      expect(order.creditsAmount).to.equal(300);
      expect(order.expirationTimestamp).to.equal(timestamp + SEVEN_DAYS); 
      expect(order.isActive).to.be.true;
      const sellerEndBalance = await carbonToken.balanceOf(seller.address, projectId);
      const contractEndBalance = await carbonToken.balanceOf(marketplace.getAddress(), projectId);
      expect(sellerEndBalance).to.equal(sellerInitBalance-BigInt(creditAmount));
      expect(contractEndBalance).to.equal(contractInitBalance+BigInt(creditAmount));
    });

    it("Should prevent creating a sell order for non-existent or non-audited project", async function () {
      const sellAmount = 300;
      await expect(
        marketplace.connect(seller).createSellOrder(
          999, // Non-existent project ID, users balance should be 0
          sellAmount, 
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWithCustomError(marketplace, insufficientBalanceError).withArgs(sellAmount);
    });

    it("Should prevent creating a sell order with insufficient token balance", async function () {
      await expect(
        marketplace.connect(seller).createSellOrder(
          projectId, 
          carbonRemoved + 1, // More than seller's balance
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWithCustomError(marketplace, insufficientBalanceError).withArgs(carbonRemoved+1);
    });

    it("Should not create a sell order for user who does not allow contract to spend credits", async function () {
      await expect(
        marketplace.connect(buyer).createSellOrder(
          projectId, 
          carbonRemoved,
          ethers.parseEther("0.1")
        )
      ).to.be.revertedWithCustomError(marketplace, transferNotApprocedError);
    });

    it("Should prevent creating a free sell order", async function () {
      await expect(
        marketplace.connect(seller).createSellOrder(
          projectId, 
          carbonRemoved,
          0
        )
      ).to.be.revertedWithCustomError(marketplace, invalidPriceError).withArgs(0);
    });

    it("Should prevent creting a sell order when market is paused", async function () {
      // Pause market
      await marketplace.connect(owner).toggleMarketplacePause();
      // Try to post a sell order
      await expect(
        marketplace.connect(seller).createSellOrder(
          projectId, 
          carbonRemoved, 
          ethers.parseEther("0.1")
        )).to.be.rejectedWith("Trading is paused");
    });
  });
  
  describe("Order Removal", function () {
    const sellAmount = BigInt(300);
    const sellPricePerCredit = ethers.parseEther("0.1");
    const totalSellPrice = sellAmount * sellPricePerCredit;
    console.log(totalSellPrice);

    beforeEach(async function () {
      // Create sell order
      await marketplace.connect(seller).createSellOrder(
        projectId, 
        sellAmount, 
        sellPricePerCredit
      );
    });

    it("Should allow order owner to remove their order", async function () {
      const sellerInitialBalance = await carbonToken.balanceOf(seller.address, projectId);
      const firstOrderId = 0;
      await expect(
        marketplace.connect(seller).removeSellOrder(firstOrderId)
      ).to.emit(marketplace, orderClosedEvent)
        .withArgs(firstOrderId, seller.address, projectId, sellAmount, totalSellPrice);

      // Verify order is inactive
      const order = await marketplace.tradeOrders(firstOrderId);
      expect(order.isActive).to.be.false;
      expect(order.expirationTimestamp).to.equal(0);
      const sellerEndBalance = await carbonToken.balanceOf(seller.address, projectId);
      expect(sellerEndBalance).to.equal(sellerInitialBalance + order.creditsAmount);
    });

    it("Should prevent non-owners from cancelling an order", async function () {
      const firstOrderId = 0;
      await expect(
        marketplace.connect(buyer).removeSellOrder(firstOrderId)
      ).to.be.revertedWithCustomError(marketplace, notOrderOwnerError);
    });

    it("Should prevent closing an inactive order", async function () {
      const firstOrderId = 0;
      await marketplace.connect(seller).removeSellOrder(firstOrderId);
      // Try removing same order again
      await expect(
        marketplace.connect(seller).removeSellOrder(firstOrderId)
      ).to.be.revertedWithCustomError(marketplace, inactiveOrderError);
    });
  });

  describe("Order Expiration", function() {// Create an order
    const orderAmount = 100;
    const pricePerCredit = ethers.parseEther("10");
    const orderPrice = BigInt(orderAmount) * pricePerCredit;
    const orderId = 0; 
    
    beforeEach(async function () {
      // Create sell order
      await marketplace.connect(seller).createSellOrder(
        projectId, 
        orderAmount, 
        pricePerCredit
      );
    });
    
    it("Should expire an order after 7 days and emit OrderExpired event", async function () { 
      // Fast forward time by 7 days + 1 second
      await time.increase(7 * 24 * 60 * 60 + 1);
  
      // Check order expiration
      const tx = await marketplace.checkOrderExpiration(orderId);
  
      // Verify event emission
      await expect(tx)
        .to.emit(marketplace, orderExpiredEvent)
        .withArgs(
          orderId, 
          seller.address, 
          projectId, 
          orderAmount, 
          orderPrice
        );
  
      // Verify order is closed
      const orderAfter = await marketplace.tradeOrders(orderId);
      expect(orderAfter.isActive).to.be.false;
    });

    it("Shouldn't expire an already closed order", async function () {
      // Fast forward time by 7 days + 1 second
      await time.increase(7 * 24 * 60 * 60 + 1);
      // Expire order
      await marketplace.checkOrderExpiration(orderId);

      // Check order expiration
      const result = await marketplace.checkOrderExpiration(orderId);
      const orderAfter = await marketplace.tradeOrders(orderId);
      expect(orderAfter.isActive).to.be.false;
      expect(result).to.emit(marketplace, orderNotExpiredEvent)
    });
  });
  // describe("Trade Execution", function () {
  //   let orderId: bigint;

  //   beforeEach(async function () {
  //     // Approve marketplace to spend tokens
  //     await carbonToken.connect(seller).setApprovalForAll(await marketplace.getAddress(), true);

  //     // Create sell order
  //     await marketplace.connect(seller).createSellOrder(
  //       projectId, 
  //       300, 
  //       ethers.parseEther("0.1")
  //     );
  //     orderId = 1n;
  //   });

  //   it("Should execute a full trade successfully", async function () {
  //     const initialSellerBalance = await ethers.provider.getBalance(seller.address);
  //     const tradeAmount = 300;
  //     const totalPrice = tradeAmount * Number(ethers.parseEther("0.1"));

  //     await expect(
  //       marketplace.connect(buyer).executeTrade(orderId, tradeAmount, {
  //         value: ethers.parseEther(String(totalPrice / 1e18))
  //       })
  //     ).to.emit(marketplace, "OrderFullyExecuted")
  //       .withArgs(orderId, buyer.address);

  //     // Verify token transfer
  //     const buyerBalance = await carbonToken.balanceOf(buyer.address, projectId);
  //     expect(buyerBalance).to.equal(tradeAmount);

  //     // Verify seller received payment
  //     const finalSellerBalance = await ethers.provider.getBalance(seller.address);
  //     expect(finalSellerBalance).to.equal(initialSellerBalance + BigInt(totalPrice));
  //   });

  //   it("Should allow partial order fills", async function () {
  //     const partialAmount = BigInt(100);
  //     const totalPrice = partialAmount * BigInt(Number(ethers.parseEther("0.1")));

  //     await expect(
  //       marketplace.connect(buyer).executeTrade(orderId, partialAmount, {
  //         value: ethers.parseEther(String(totalPrice / BigInt(1e18)))
  //       })
  //     ).to.emit(marketplace, "PartialOrderFilled")
  //       .withArgs(
  //         orderId, 
  //         buyer.address, 
  //         seller.address,
  //         partialAmount, 
  //         totalPrice
  //       );

  //     // Check remaining amount
  //     const order = await marketplace.tradeOrders(orderId);
  //     expect(order.remainingAmount).to.equal(200);
  //   });

  //   it("Should prevent trading more credits than available", async function () {
  //     await expect(
  //       marketplace.connect(buyer).executeTrade(orderId, 400, {
  //         value: ethers.parseEther("40")
  //       })
  //     ).to.be.revertedWith("Requested amount exceeds available credits");
  //   });

  //   it("Should prevent trading on an inactive order", async function () {
  //     // Cancel the order first
  //     await marketplace.connect(seller).cancelSellOrder(orderId);

  //     await expect(
  //       marketplace.connect(buyer).executeTrade(orderId, 100, {
  //         value: ethers.parseEther("10")
  //       })
  //     ).to.be.revertedWith("Order is not active");
  //   });
  // });
});