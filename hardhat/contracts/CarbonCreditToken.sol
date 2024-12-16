// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.22;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Burnable} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Burnable.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import "./CarbonProjectRegistry.sol";

contract CarbonCreditToken is ERC1155, ERC1155Burnable, AccessControl, ERC1155Supply {
    bytes32 public constant TOKEN_MANAGER_ROLE = keccak256("TOKEN_MANAGER_ROLE");
    CarbonProjectRegistry public projectRegistry;

    constructor(
        address _defaultAdmin, 
        address _manager, 
        address _registryAddress
    ) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, _defaultAdmin);
        _grantRole(TOKEN_MANAGER_ROLE, _manager);
        projectRegistry = CarbonProjectRegistry(_registryAddress);
    }

    function mintCredits(
        address _to, 
        uint64 _projectId, 
        uint256 _amount, 
        bytes calldata _data
    )
        external
        onlyRole(TOKEN_MANAGER_ROLE)
    {
        if(!projectRegistry.projectExists(_projectId))
            revert ProjectNotFound(_projectId);
        uint256 allowedAmount = projectRegistry.getProjectIssuedCredits(_projectId) - totalSupply(_projectId);
        if(allowedAmount < _amount) // Effectively checks if project is audited or not because non edited project cannot have a supply
            revert MintExceedsIssuedCredits(_projectId, allowedAmount);

        _mint(_to, _projectId, _amount, _data);
        emit CreditsMinted(_to, _projectId, _amount);
    }

    // Mint Batch currently not supported

    function mintCreditsBatch(
        address _to, 
        uint256[] memory _projectIds, 
        uint256[] memory _amounts, 
        bytes memory _data
    )
        public
        onlyRole(TOKEN_MANAGER_ROLE)
    {
        if(_projectIds.length != _amounts.length)
            revert MismatchingArrayLengths();
        for(uint256 i = 0; i < _projectIds.length; i++){
            uint256 id = _projectIds[i];
            if(!projectRegistry.projectExists(id))
                revert ProjectNotFound(id);
            uint256 allowedAmount = projectRegistry.getProjectIssuedCredits(id) - totalSupply(id);
            if(allowedAmount < _amounts[i])
                revert MintExceedsIssuedCredits(id, allowedAmount);
        }
        _mintBatch(_to, _projectIds, _amounts, _data);
        emit CreditsMintedBatch(_to, _projectIds, _amounts);
    }

    function retireCredits(
        uint256 _projectId, 
        uint256 _amount, 
        string calldata _description
    ) 
        external
    {
        if(balanceOf(msg.sender, _projectId) < _amount){
            revert InsufficientBalance(_projectId);
        }

        _burn(msg.sender, _projectId, _amount);

        // Emit retirement event
        emit CreditRetired(
            msg.sender, 
            _projectId, 
            _amount, 
            block.timestamp,
            _description
        );
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC1155, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    error InsufficientBalance(uint256 projectId);
    error MintExceedsIssuedCredits(uint256 projectId, uint256 allowedAmount);
    error MismatchingArrayLengths();
    error ProjectNotFound(uint256 projectId);

    event CreditsMinted(
        address indexed to,
        uint256 indexed projectId,
        uint256 amount
    );

    event CreditsMintedBatch(
        address indexed to,
        uint256[] indexed projectId,
        uint256[] amount
    );

    // Event to log credit retirements
    event CreditRetired(
        address indexed retiree, 
        uint256 indexed projectId, 
        uint256 amount,
        uint256 timestamp,
        string emissionDescription
    );
}
