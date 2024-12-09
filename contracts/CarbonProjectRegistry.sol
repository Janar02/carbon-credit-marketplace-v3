// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract CarbonProjectRegistry is AccessControl {
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant PROJECT_OWNER_ROLE = keccak256("PROJECT_OWNER_ROLE");

    struct ProjectMetadata {
        ProjectStatus status;
        // Verifier verifierBody; Move inside ipfs
        bytes32 uniqueVerificationId;
        address projectOwner;
        uint256 authenticationDate;
        uint256 carbonRemoved;
        uint256 creditsIssued;
        string ipfsCID;
        // string projectName; Move inside ipfs
    }

    enum ProjectStatus {
        Pending,
        Audited,
        Rejected
    }

    mapping(uint256 => ProjectMetadata) public projects;
    uint256 private projectCount;

    mapping(bytes32 => bool) private registeredProjects;
    
    uint8 public immutable mintPercentage; // 10% of credits are withheld to assure environmental integrity

    constructor(uint8 _percentageToBeMinted, address defaultAdmin, address defaultProjectOwner) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(AUDITOR_ROLE, defaultAdmin);
        _grantRole(PROJECT_OWNER_ROLE, defaultProjectOwner);
        mintPercentage = _percentageToBeMinted;
    }

    event ProjectAdded(
        address indexed projectOwner,
        uint256 indexed projectId,
        uint256 carbonRemoved,
        string ipfsCID
    );

    function addProject(
        uint256 _carbonRemoved,
        string memory _ipfsCID,
        string memory _uniqueVerificationId
    ) 
        external
        onlyRole(PROJECT_OWNER_ROLE) 
    {
        bytes32 projectHash = keccak256(bytes(_uniqueVerificationId));
        require(!registeredProjects[projectHash], "This project already exists!");
        projects[projectCount] = ProjectMetadata({
            status: ProjectStatus.Pending,
            ipfsCID: _ipfsCID,
            projectOwner: msg.sender,
            authenticationDate: 0,
            carbonRemoved: _carbonRemoved,
            uniqueVerificationId: projectHash,
            creditsIssued: 0
        });
        registeredProjects[projectHash] = true;
        emit ProjectAdded(msg.sender, projectCount, _carbonRemoved, _ipfsCID);
        projectCount++;
    }

    function updateProjectMetaData(uint256 projectId, string memory _newIpfsCID) 
        external 
        onlyRole(PROJECT_OWNER_ROLE)
    {
        require(projectExists(projectId), "Project does not exist");
        require(projects[projectId].projectOwner == msg.sender, "You are not authorized to update the project");
        require(projects[projectId].status == ProjectStatus.Rejected || projects[projectId].status == ProjectStatus.Pending, "Project cannot be updated");
        
        projects[projectId].ipfsCID = _newIpfsCID;
        projects[projectId].status = ProjectStatus.Pending;
    }

    function updateProjectStatus(uint256 _projectId, ProjectStatus _newStatus) private {
        projects[_projectId].status = _newStatus;
        projects[_projectId].authenticationDate = block.timestamp;
    }

    function getRiskCorrectedCreditAmount(uint256 amount) private view returns(uint256) {
        return amount * mintPercentage / 100;
    }

    function acceptProject(uint256 _projectId) public onlyRole(AUDITOR_ROLE) {
        require(projectExists(_projectId), "Project does not exist");
        updateProjectStatus(_projectId, ProjectStatus.Audited);
        projects[_projectId].creditsIssued = getRiskCorrectedCreditAmount(projects[_projectId].carbonRemoved);
    }
    
    function rejectProject(uint256 _projectId) public onlyRole(AUDITOR_ROLE) {
        require(projectExists(_projectId), "Project does not exist");
        updateProjectStatus(_projectId, ProjectStatus.Rejected);
    }

    function projectExists(uint256 id) public view returns (bool) {
        bytes32 _uniqueVerificationId = projects[id].uniqueVerificationId;
        if (_uniqueVerificationId == 0)
            return false;
        return registeredProjects[_uniqueVerificationId];
    }

    function getProjectIssuedCredits(uint256 projectId) public view returns(uint256) {
        return projects[projectId].creditsIssued;
    }

    function isProjectAudited(uint256 projectId) public view returns(bool) {
        return projects[projectId].status == ProjectStatus.Audited;
    }
}