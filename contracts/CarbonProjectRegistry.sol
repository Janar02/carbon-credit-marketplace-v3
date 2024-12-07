// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract CarbonProjectRegistry is AccessControl {
    bytes32 public constant AUDITOR_ROLE = keccak256("AUDITOR_ROLE");
    bytes32 public constant PROJECT_OWNER_ROLE = keccak256("PROJECT_OWNER_ROLE");

    struct ProjectMetadata {
        string ipfsCID;
        string projectName;
        address projectOwner;
        ProjectStatus status;
        uint256 authenticationDate;
        uint256 carbonRemoved;
        uint256 creditsIssued;
        string uniqueVerificationId;
        VerificationBodies verifier;
    }

    enum ProjectStatus {
        Pending,
        Audited,
        Rejected
    }

    enum VerificationBodies{
        VCS, // aka Verra
        Gold_Standard,
        CAR,
        ACR
    }
    uint8 VerificationBodiesCount = 4;

    mapping(uint256 => ProjectMetadata) public projects;
    uint256 private projectCount;

    mapping(bytes32 => bool) public registeredProjects;
    
    uint8 public creditRiskBuffer = 10; // 10% of credits are withheld to assure environmental integrity

    constructor(address defaultAdmin, address defaultProjectOwner) {
        _grantRole(DEFAULT_ADMIN_ROLE, defaultAdmin);
        _grantRole(AUDITOR_ROLE, defaultAdmin);
        _grantRole(PROJECT_OWNER_ROLE, defaultProjectOwner);
    }

    event ProjectAdded(
        uint256 indexed projectId,
        string ipfsCID,
        string projectName,
        uint256 carbonRemoved,
        address indexed projectOwner
    );

    function updateProjectRegistration(bytes32 projectHash, bool isRegistered) private {
        registeredProjects[projectHash] = isRegistered;
    }

    function convertToVerificationBody(uint8 _bodyIndex) public view returns (VerificationBodies) {
        require(_bodyIndex < VerificationBodiesCount, "Invalid verification body index");
        return VerificationBodies(_bodyIndex);
    }

    function addProject(
        string memory _ipfsCID, 
        string memory _projectName,
        uint256 _carbonRemoved,
        string memory _uniqueVerificationId,
        VerificationBodies _verifier
    ) 
        external
        onlyRole(PROJECT_OWNER_ROLE) 
    {
        bytes32 projectHash = keccak256((abi.encodePacked(bytes(_uniqueVerificationId), bytes(_projectName), _verifier)));
        require(!registeredProjects[projectHash], "This project already exists!");
        projects[projectCount] = ProjectMetadata({
            ipfsCID: _ipfsCID,
            projectName: _projectName,
            projectOwner: msg.sender,
            status: ProjectStatus.Pending,
            authenticationDate: 0,
            carbonRemoved: _carbonRemoved,
            uniqueVerificationId: _uniqueVerificationId,
            verifier: _verifier,
            creditsIssued: 0
        });
        updateProjectRegistration(projectHash, true);
        emit ProjectAdded(projectCount, _ipfsCID, _projectName, _carbonRemoved, msg.sender);
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
        return amount - amount * creditRiskBuffer / 100;
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

    function projectExists(uint256 id) public view returns(bool) {
        bytes32 projectHash = keccak256((
            abi.encodePacked(
                bytes(projects[id].uniqueVerificationId), 
                bytes(projects[id].projectName), 
                projects[id].verifier
            )
        ));
        return registeredProjects[projectHash];
    }

    function getProjectIssuedCredits(uint256 projectId) public view returns(uint256) {
        return projects[projectId].creditsIssued;
    }

    function isProjectAudited(uint256 projectId) public view returns(bool) {
        return projects[projectId].status == ProjectStatus.Audited;
    }
}