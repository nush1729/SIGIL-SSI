// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract NeuralHashTrustRegistry {

    address public owner;
    uint256 public minimumStake;

    struct Issuer {
        string name;          // Human-readable name
        string metadataURI;   // Optional IPFS link with more details
        bool isTrusted;       // Trust status
        uint256 addedAt;      // Timestamp
    }

    mapping(address => Issuer) private issuers;
    mapping(address => uint256) public stakedAmount;

    event IssuerUpdated(
        address indexed issuer,
        string name,
        string metadataURI,
        bool isTrusted
    );
    event StakeDeposited(address indexed issuer, uint256 amount, uint256 totalStaked);
    event StakeWithdrawn(address indexed issuer, uint256 amount, uint256 totalStaked);
    event IssuerSlashed(address indexed issuer, uint256 amount, uint256 remainingStake);
    event MinimumStakeUpdated(uint256 newMinimumStake);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor(uint256 _minimumStake) {
        owner = msg.sender;
        minimumStake = _minimumStake;
    }

    // ---------------- Staking ----------------
    // Trust is no longer a free, purely administrative allow-list entry: an
    // issuer must first put up real collateral, which the owner can slash if
    // that issuer is found to have issued a fraudulent credential. This adds
    // an economic cost to misbehavior beyond just being de-listed.

    function depositStake() external payable {
        stakedAmount[msg.sender] += msg.value;
        emit StakeDeposited(msg.sender, msg.value, stakedAmount[msg.sender]);
    }

    // Only withdrawable while not currently trusted — otherwise a trusted
    // issuer could withdraw their collateral out from under active
    // credentials they've issued, defeating the point of staking.
    function withdrawStake(uint256 amount) external {
        require(!issuers[msg.sender].isTrusted, "Revoke trust before withdrawing stake");
        require(stakedAmount[msg.sender] >= amount, "Insufficient stake");

        stakedAmount[msg.sender] -= amount;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        require(success, "Withdrawal failed");

        emit StakeWithdrawn(msg.sender, amount, stakedAmount[msg.sender]);
    }

    // Slashes a misbehaving issuer's stake, sends the slashed amount to the
    // registry owner, and immediately revokes their trusted status.
    function slash(address issuer, uint256 amount) external onlyOwner {
        require(stakedAmount[issuer] >= amount, "Amount exceeds stake");

        stakedAmount[issuer] -= amount;
        issuers[issuer].isTrusted = false;

        (bool success, ) = payable(owner).call{value: amount}("");
        require(success, "Slash transfer failed");

        emit IssuerSlashed(issuer, amount, stakedAmount[issuer]);
        emit IssuerUpdated(
            issuer,
            issuers[issuer].name,
            issuers[issuer].metadataURI,
            false
        );
    }

    function setMinimumStake(uint256 _minimumStake) external onlyOwner {
        minimumStake = _minimumStake;
        emit MinimumStakeUpdated(_minimumStake);
    }

    // ---------------- Trust Management ----------------

    // Add or update issuer trust status. Granting trust (_isTrusted = true)
    // requires the issuer to already have staked at least `minimumStake`.
    function setIssuer(
        address _issuer,
        string calldata _name,
        string calldata _metadataURI,
        bool _isTrusted
    ) external onlyOwner {
        if (_isTrusted) {
            require(stakedAmount[_issuer] >= minimumStake, "Issuer has not staked enough");
        }

        issuers[_issuer] = Issuer({
            name: _name,
            metadataURI: _metadataURI,
            isTrusted: _isTrusted,
            addedAt: block.timestamp
        });

        emit IssuerUpdated(
            _issuer,
            _name,
            _metadataURI,
            _isTrusted
        );
    }

    // Check if issuer is trusted
    function isTrusted(address _issuer)
        external
        view
        returns (bool)
    {
        return issuers[_issuer].isTrusted;
    }

    // Get full issuer details
    function getIssuer(address _issuer)
        external
        view
        returns (
            string memory name,
            string memory metadataURI,
            bool trusted,
            uint256 addedAt
        )
    {
        Issuer memory issuer = issuers[_issuer];

        return (
            issuer.name,
            issuer.metadataURI,
            issuer.isTrusted,
            issuer.addedAt
        );
    }

    // Optional: Transfer ownership
    function transferOwnership(address newOwner)
        external
        onlyOwner
    {
        require(newOwner != address(0), "Zero address");
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }
}
