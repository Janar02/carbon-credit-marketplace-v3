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
    // Struct to represent retirement details
    struct RetirementRecord {
        address retiringEntity;
        uint256 amount;
        uint256 timestamp;
        string emissionDescription;
    }

    // Mapping to track retirements
    mapping(bytes32 => RetirementRecord) public retirementRecords;

    // Event to log credit retirements
    event CreditRetired(
        address indexed retiree, 
        uint256 indexed projectId, 
        uint256 amount, 
        string emissionDescription
    );

    constructor(
        address defaultAdmin, 
        address manager, 
        address _registryAddress
    ) ERC1155("") {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(TOKEN_MANAGER_ROLE, manager);
        projectRegistry = CarbonProjectRegistry(_registryAddress);
    }

    function mintCredits(
        address account, 
        uint256 id, 
        uint256 amount, 
        bytes memory data
    )
        external
        onlyRole(TOKEN_MANAGER_ROLE)
    {
        require(projectRegistry.projectExists(id), "Project with this ID does not exist");
        require(projectRegistry.getProjectIssuedCredits(id) >= amount + totalSupply(id), "Minting this amount would surpass the issued credits limit");
        _mint(account, id, amount, data);
    }

    function retireCredits(
        uint256 projectId, 
        uint256 amount, 
        string memory emissionDescription
    ) 
        external
        onlyRole(TOKEN_MANAGER_ROLE)
    {
        require(balanceOf(msg.sender, projectId) >= amount, "Insufficient credit balance");

        bytes32 retirementId = keccak256(
            abi.encodePacked(
                msg.sender, 
                projectId, 
                amount, 
                block.timestamp
            )
        );

        _burn(msg.sender, projectId, amount);

        // Create retirement record
        retirementRecords[retirementId] = RetirementRecord({
            retiringEntity: msg.sender,
            amount: amount,
            timestamp: block.timestamp,
            emissionDescription: emissionDescription
        });

        // Emit retirement event
        emit CreditRetired(
            msg.sender, 
            projectId, 
            amount, 
            emissionDescription
        );
    }

    // Mint Batch currently not supported

    // function mintBatch(address to, uint256[] memory ids, uint256[] memory amounts, bytes memory data)
    //     public
    //     onlyRole(MINTER_ROLE)
    // {
    //     _mintBatch(to, ids, amounts, data);
    // }

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
}
