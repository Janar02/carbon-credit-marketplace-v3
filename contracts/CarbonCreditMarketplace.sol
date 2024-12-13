// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./CarbonCreditToken.sol";
import "./CarbonProjectRegistry.sol";

contract CarbonCreditMarketplace is Ownable, ReentrancyGuard, ERC1155Holder  {
    
    bool public marketplacePaused;
    uint16 public platformFeeBasisPoints = 120; // 1.2% initially
    uint16 private constant BIPS_DENOMINATOR = 10000; // platform fee can display % with 2 decimal places
    uint256 private constant ORDER_EXPIRATION_PERIOD = 7 days;

    // Modifier to restrict functions to when marketplace is not paused
    modifier whenNotPaused() {
        require(!marketplacePaused, "Trading is paused");
        _;
    }

    // Contracts we'll interact with
    CarbonCreditToken public carbonToken;
    CarbonProjectRegistry public projectRegistry;

    // Trade order structure
    struct TradeOrder {
        bool isActive;
        address seller;
        uint256 projectId;
        uint256 creditsAmount;     // Total amount of credits
        uint256 orderPrice;         // in wei
        uint256 expirationTimestamp;
    }

    // Mapping of order ID to Trade Order
    mapping(uint256 => TradeOrder) public tradeOrders;
    uint256 internal nextOrderId;

    constructor(
        address _carbonTokenAddress, 
        address _projectRegistryAddress,
        address _initialOwner
    ) Ownable(_initialOwner){
        carbonToken = CarbonCreditToken(_carbonTokenAddress);
        projectRegistry = CarbonProjectRegistry(_projectRegistryAddress);
    }
    
    function updatePlatformFee(uint16 newFeeBasisPoints) external onlyOwner {
        require(newFeeBasisPoints <= 1000, "Fee cannot exceed 10%");
        platformFeeBasisPoints = newFeeBasisPoints;
        emit PlatformFeeUpdated(newFeeBasisPoints);
    }

    function toggleMarketplacePause() external onlyOwner {
        marketplacePaused = !marketplacePaused;
        emit MarketplacePauseStatusChanged(marketplacePaused);
    }

    // Create a sell order for carbon credits
    function createSellOrder(
        uint256 _projectId, 
        uint256 _amount, 
        uint256 _pricePerCredit
    ) external whenNotPaused {
        if(!carbonToken.isApprovedForAll(msg.sender, address(this))) 
            revert TransferNotApproved();
        if(_pricePerCredit == 0) 
            revert InvalidPrice(_pricePerCredit);
        if(_amount > carbonToken.balanceOf(msg.sender, _projectId)) 
            revert InsufficientBalance(_amount);
        uint256 orderId = nextOrderId++;

        // Transfer tokens to this address
        carbonToken.safeTransferFrom(msg.sender, address(this), _projectId, _amount, "");

        unchecked{
            uint256 totalPrice = _amount * _pricePerCredit;

            // Create trade order
            tradeOrders[orderId] = TradeOrder({
                seller: msg.sender,
                projectId: _projectId,
                creditsAmount: _amount,
                orderPrice: totalPrice,
                isActive: true,
                expirationTimestamp: block.timestamp + ORDER_EXPIRATION_PERIOD
            });

            emit OrderCreated(
                orderId, 
                msg.sender, 
                _projectId, 
                _amount, 
                totalPrice
            );
        }
    }

    // Execute a trade order
    function executeTrade(uint256 _orderId) external payable whenNotPaused nonReentrant {        
        TradeOrder memory order = tradeOrders[_orderId];        
        // Initial checks
        if(!order.isActive || checkOrderExpiration(_orderId)) revert InactiveOrder(_orderId);
        if(msg.value < order.orderPrice) revert InsufficientPayment();
        
        // Calculate platform fee and seller proceeds
        uint256 platformFee = order.orderPrice * platformFeeBasisPoints / BIPS_DENOMINATOR;
        uint256 sellerProceeds = order.orderPrice - platformFee;

        // Transfer credits from contract to buyer
        carbonToken.safeTransferFrom(address(this), msg.sender, _orderId, order.creditsAmount, "");

        // Pay credit seller
        (bool sellerSent,) = payable(order.seller).call{value: sellerProceeds}("");
        (bool feeSent,) = payable(owner()).call{value: platformFee}("");
        if (!sellerSent || !feeSent) revert TransferFailed();

        // Refund excess
        uint256 refundAmount = msg.value - order.orderPrice;
        if (refundAmount > 0) {
            (bool refundSent,) = payable(msg.sender).call{value: refundAmount}("");
            if (!refundSent) revert RefundFailed();
        }

        tradeOrders[_orderId].isActive = false;
        tradeOrders[_orderId].expirationTimestamp = 0;
        // emit event
        emit OrderFilled(msg.sender, order.seller, _orderId, order.creditsAmount, order.orderPrice);
    }

    // Cancel an existing sell order
    function removeSellOrder(uint256 _orderId) external whenNotPaused {
        TradeOrder memory order = tradeOrders[_orderId];
        if(!order.isActive) revert InactiveOrder(_orderId);
        if(order.seller != msg.sender) revert NotOrderOwner();
        closeOrder(_orderId);        
        emit OrderClosed(_orderId, msg.sender, order.projectId, order.creditsAmount, order.orderPrice);
    }

    function checkOrderExpiration(uint256 _orderId) public returns(bool){
        TradeOrder memory order = tradeOrders[_orderId];
        if(order.isActive && block.timestamp > order.expirationTimestamp){
            closeOrder(_orderId);
            emit OrderExpired(_orderId, order.seller, order.projectId, order.creditsAmount, order.orderPrice);
            return true;
        }
        emit OrderNotExpired(_orderId);
        return false;
    }

    function closeOrder(uint256 _orderId) private {
        tradeOrders[_orderId].isActive = false;
        tradeOrders[_orderId].expirationTimestamp = 0;
        address seller = tradeOrders[_orderId].seller;
        uint256 credits = tradeOrders[_orderId].creditsAmount;
        carbonToken.safeTransferFrom(address(this), seller, _orderId, credits, "");
    }
    
    error InactiveOrder(uint256 orderId);
    error InsufficientBalance(uint256 amount);
    error InsufficientPayment();
    error InvalidAmount(uint256 amount);
    error InvalidPrice(uint256 price);
    error NotOrderOwner();
    error RefundFailed();
    error TradingIsPaused();
    error TransferFailed();
    error TransferNotApproved();

    event MarketplacePauseStatusChanged(bool isPaused);
    event OrderCreated(
        uint256 indexed orderId, 
        address indexed seller, 
        uint256 indexed projectId, 
        uint256 creditsAmount,
        uint256 orderPrice
    );
    event OrderFilled(
        address indexed buyer, 
        address indexed seller,
        uint256 indexed orderId, 
        uint256 amountFilled, 
        uint256 totalPrice
    );
    event OrderClosed(
        uint256 indexed orderId, 
        address indexed closedBy, 
        uint256 indexed projectId, 
        uint256 creditsAmount,
        uint256 orderPrice 
    );
    event OrderExpired(
        uint256 indexed orderId, 
        address indexed seller, 
        uint256 indexed projectId, 
        uint256 creditsAmount,
        uint256 orderPrice 
    );
    event OrderNotExpired(uint256 orderId);
    event PlatformFeeUpdated(uint256 newFeeBasisPoints);
}