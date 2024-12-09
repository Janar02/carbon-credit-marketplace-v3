// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "./CarbonCreditToken.sol";
import "./CarbonProjectRegistry.sol";

contract CarbonCreditMarketplace is AccessControl {
    // Define roles for marketplace management
    bytes32 public constant MARKETPLACE_ADMIN_ROLE = keccak256("MARKETPLACE_ADMIN_ROLE");

    // Contracts we'll interact with
    CarbonCreditToken public carbonToken;
    CarbonProjectRegistry public projectRegistry;

    // Trade order structure
    struct TradeOrder {
        bool isActive;
        address seller;
        uint256 projectId;
        uint256 totalAmount;      // Original total amount of credits
        uint256 remainingAmount;  // Amount still available for purchase
        uint256 pricePerCredit; // in wei
    }

    // Mapping of order ID to Trade Order
    mapping(uint256 => TradeOrder) public tradeOrders;
    uint256 public nextOrderId;

    // Events for transparency
    event OrderCreated(
        address indexed seller, 
        uint256 indexed orderId, 
        uint256 projectId, 
        uint256 totalAmount,
        uint256 pricePerCredit
    );

    event PartialOrderFilled(
        uint256 indexed orderId, 
        address indexed buyer, 
        address indexed seller,
        uint256 amountFilled, 
        uint256 totalPaid
    );

    event OrderFullyExecuted(
        uint256 indexed orderId, 
        address indexed buyer
    );

    event OrderCancelled(uint256 indexed orderId);

    constructor(
        address _carbonTokenAddress, 
        address _projectRegistryAddress,
        address _marketplaceAdmin
    ) {
        carbonToken = CarbonCreditToken(_carbonTokenAddress);
        projectRegistry = CarbonProjectRegistry(_projectRegistryAddress);
        
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MARKETPLACE_ADMIN_ROLE, _marketplaceAdmin);
        
        nextOrderId = 1;
    }

    // Create a sell order for carbon credits
    function createSellOrder(
        uint256 projectId, 
        uint256 amount, 
        uint256 pricePerCredit
    ) external {
        // Verify project exists and is audited
        require(
            projectRegistry.projectExists(projectId) && 
            projectRegistry.isProjectAudited(projectId), 
            "Invalid or non-audited project"
        );

        // Check seller owns and approves the tokens
        require(
            carbonToken.balanceOf(msg.sender, projectId) >= amount, 
            "Insufficient token balance"
        );

        // Create trade order
        tradeOrders[nextOrderId] = TradeOrder({
            seller: msg.sender,
            projectId: projectId,
            totalAmount: amount,
            remainingAmount: amount,
            pricePerCredit: pricePerCredit,
            isActive: true
        });

        emit OrderCreated(
            msg.sender, 
            nextOrderId, 
            projectId, 
            amount, 
            pricePerCredit
        );

        nextOrderId++;
    }

    // Execute a trade order
    function executeTrade(uint256 orderId, uint256 requestedAmount) external payable {
        TradeOrder storage order = tradeOrders[orderId];
        
        require(order.isActive, "Order is not active");        
        require(requestedAmount > 0, "Cannot purchase zero credits");
        require(requestedAmount <= order.remainingAmount, "Requested amount exceeds available credits");

        // Calculate marketplace fee
        uint256 totalPrice = requestedAmount * order.pricePerCredit;
        require(msg.value >= totalPrice, "Insufficient payment");

        // Transfer carbon credits
        carbonToken.safeTransferFrom(
            order.seller, 
            msg.sender, 
            order.projectId, 
            order.totalAmount, 
            ""
        );

        // Send payment to seller
        payable(order.seller).transfer(totalPrice);

        // update order details
        order.remainingAmount -= requestedAmount;

        // Emit appropriate event
        if(order.remainingAmount == 0){
            order.isActive = false;
            emit OrderFullyExecuted(orderId, msg.sender);
        }else{
            emit PartialOrderFilled(orderId, msg.sender, order.seller, requestedAmount, totalPrice);
        }

        // Refund any excess payment
        if (msg.value > totalPrice) {
            payable(msg.sender).transfer(msg.value - totalPrice);
        }
    }

    // Cancel an existing sell order
    function cancelSellOrder(uint256 orderId) external {
        TradeOrder storage order = tradeOrders[orderId];
        require(order.seller == msg.sender, "Not order owner");
        require(order.isActive, "Order already inactive");

        order.isActive = false;
        emit OrderCancelled(orderId);
    }
}