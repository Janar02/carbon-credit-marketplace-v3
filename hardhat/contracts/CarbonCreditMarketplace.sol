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
    uint16 public constant closeExpiredOrderReward = 10; // 0.1% of order price
    uint16 private constant BIPS_DENOMINATOR = 10000; // platform fee can display % with 2 decimal places
    uint256 private constant ORDER_EXPIRATION_PERIOD = 7 days;

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
    // Mapping to store how much 
    mapping(address => uint256) public accountBalances;

    // Modifier to restrict functions to when marketplace is not paused
    modifier whenNotPaused() {
        require(!marketplacePaused, "Trading is paused");
        _;
    }

    constructor(
        address _carbonTokenAddress, 
        address _projectRegistryAddress,
        address _initialOwner
    ) payable Ownable(_initialOwner){
        carbonToken = CarbonCreditToken(_carbonTokenAddress);
        projectRegistry = CarbonProjectRegistry(_projectRegistryAddress);
    }

    receive() external payable {
        accountBalances[address(this)] += msg.value;
    }

    fallback() external payable {
        emit FallbackCalled(msg.sender, msg.value, msg.data);
    }
    
    function updatePlatformFee(uint16 newFeeBasisPoints) external onlyOwner {
        require(newFeeBasisPoints <= 1000, "Fee cannot exceed 10%");
        require(newFeeBasisPoints > closeExpiredOrderReward, "Fee is too small");
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
        if(!order.isActive) revert InactiveOrder(_orderId); // Revert if order is inactive
        if(order.isActive && order.expirationTimestamp < block.timestamp){  // Revert and change order statuses if order is active but expired
            closeOrder(_orderId);
            emit ExpiredOrderClosed(_orderId, order.seller, order.projectId, order.creditsAmount, order.orderPrice);
            revert ExpiredOrder(_orderId); // Would this also revert the changes made by closeOrder function?
        } 
        if(msg.value < order.orderPrice) revert InsufficientPayment();  // Revert if sender did not include enough value

        // Modify order state
        tradeOrders[_orderId].isActive = false;
        tradeOrders[_orderId].expirationTimestamp = 0;
        
        unchecked{
            // Calculate platform fee and seller proceeds
            uint256 platformFee = order.orderPrice * platformFeeBasisPoints / BIPS_DENOMINATOR;
            uint256 sellerProceeds = order.orderPrice - platformFee;

            // Transfer credits from contract to buyer
            carbonToken.safeTransferFrom(address(this), msg.sender, _orderId, order.creditsAmount, "");

            // Update account balances of seller and current address
            accountBalances[order.seller] += sellerProceeds;
            accountBalances[address(this)] += platformFee;

            // Refund excess
            uint256 refundAmount = msg.value - order.orderPrice;
            if (refundAmount > 0) {
                (bool refundSent,) = payable(msg.sender).call{value: refundAmount}("");
                if (!refundSent) revert RefundFailed();
            }
            // emit event
            emit OrderFilled(msg.sender, order.seller, _orderId, order.creditsAmount, order.orderPrice);
        }
    }

    // Cancel an existing sell order
    function removeSellOrder(uint256 _orderId) external whenNotPaused {
        TradeOrder memory order = tradeOrders[_orderId];
        if(!order.isActive) revert InactiveOrder(_orderId);
        if(order.seller != msg.sender) revert NotOrderOwner();
        closeOrder(_orderId);        
        emit OrderClosed(_orderId, msg.sender, order.projectId, order.creditsAmount, order.orderPrice);
    }

    function closeExpiredOrder(uint256 _orderId) external {
        TradeOrder memory order = tradeOrders[_orderId];
        if(order.isActive && block.timestamp > order.expirationTimestamp){
            closeOrder(_orderId);
            unchecked{
                uint256 callerProceeds = order.orderPrice * closeExpiredOrderReward / BIPS_DENOMINATOR; // Pay caller
                uint256 contractBalance = accountBalances[address(this)];
                if(contractBalance < callerProceeds)
                    revert InsufficientBalance(callerProceeds);
                accountBalances[address(this)] -= callerProceeds;
                accountBalances[msg.sender] += callerProceeds;
            }
            emit ExpiredOrderClosed(_orderId, order.seller, order.projectId, order.creditsAmount, order.orderPrice);
        }
        emit OrderNotExpired(_orderId);
    }

    function batchCloseExpiredOrders(uint256[] calldata _orderIds) external onlyOwner {
        uint256 length = _orderIds.length;
        uint256[] memory expiredOrders = new uint256[](length);
        uint256 expiredCount;
        uint callerPayout;
        uint256 contractBalance = accountBalances[address(this)];
        for(uint256 i = 0; i < length; i++){
            uint256 id = _orderIds[i];
            TradeOrder memory order = tradeOrders[id];
            if(order.isActive && block.timestamp > order.expirationTimestamp){
                closeOrder(id);
                unchecked{
                    callerPayout += order.orderPrice * closeExpiredOrderReward / BIPS_DENOMINATOR; // Pay caller
                    if(contractBalance < callerPayout)
                        revert InsufficientBalance(callerPayout);
                    expiredOrders[expiredCount] = id;
                    expiredCount++;
                }
            }
            if(order.isActive && block.timestamp < order.expirationTimestamp){
                emit OrderNotExpired(id);
            }
        }
        if(callerPayout > 0)
        {
            accountBalances[address(this)] -= callerPayout;
            accountBalances[msg.sender] += callerPayout;
        }
        emit BatchExpiredOrdersClosed(expiredOrders);
    }

    function closeOrder(uint256 _orderId) private {
        tradeOrders[_orderId].isActive = false;
        tradeOrders[_orderId].expirationTimestamp = 0;
        TradeOrder memory order = tradeOrders[_orderId];
        carbonToken.safeTransferFrom(address(this), order.seller, order.projectId, order.creditsAmount, "");
    }

    function withdrawAccountBalance(address _to, uint256 _withdrawAmount) public {
        uint256 _accountBalance = accountBalances[msg.sender];
        if(_accountBalance < _withdrawAmount)
            revert InsufficientBalance(_accountBalance);
        accountBalances[msg.sender] -= _withdrawAmount;
        (bool transferSuccessful,) = payable(_to).call{value: _withdrawAmount}("");
        if(!transferSuccessful)
            revert TransferFailed();
    }
    
    error ExpiredOrder(uint256 orderId);
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

    event BatchExpiredOrdersClosed(uint256[] orderIds);
    event FallbackCalled(address sender, uint256 value, bytes data);
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
    event ExpiredOrderClosed(
        uint256 indexed orderId, 
        address indexed seller, 
        uint256 indexed projectId, 
        uint256 creditsAmount,
        uint256 orderPrice 
    );
    event OrderNotExpired(uint256 orderId);
    event PlatformFeeUpdated(uint256 newFeeBasisPoints);
}