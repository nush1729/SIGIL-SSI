// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface INeuralHashSSI {
    function verifyCredential(address user, bytes32 credentialHash) external view returns (bool);
}

contract Identity {

    address public owner;
    INeuralHashSSI public immutable ssiRegistry;

    address[] public guardianList;
    mapping(address => bool) public guardians;
    uint256 public guardianCount;
    uint256 public recoveryThreshold;

    // Pointers into NeuralHashSSI's canonical credential store — this contract
    // does not keep its own copy of credential data.
    bytes32[] public linkedCredentialHashes;
    mapping(bytes32 => bool) public isLinkedCredential;

    // Recovery voting
    address public proposedOwner;
    mapping(address => bool) public guardianVotes;
    uint256 public voteCount;

    // Timelock: once guardian votes reach threshold, ownership does not
    // transfer immediately. `recoveryReadyAt` is set to the earliest time
    // `finalizeRecovery()` may be called. This gives the *current* owner a
    // window to notice and cancel a recovery they did not authorize (e.g.
    // colluding/malicious guardians attempting a hostile takeover) before it
    // completes — the gap the project's threat model named as unmitigated.
    // Trade-off, stated explicitly: if the owner's own key is compromised
    // instead, the attacker holding it can likewise call cancelRecovery()
    // during the window. That does not lock guardians out permanently —
    // they can simply propose again, restarting the clock — it only means a
    // watching attacker can indefinitely delay (not prevent) recovery, which
    // is the accepted trade-off documented in docs/threat-model.md.
    uint256 public immutable recoveryTimelock;
    uint256 public recoveryReadyAt;

    event CredentialLinked(bytes32 indexed credentialHash);
    event RecoveryProposed(address indexed proposedOwner, address indexed proposedBy);
    event RecoveryVoted(address indexed guardian, address indexed proposedOwner, uint256 voteCount);
    event RecoveryThresholdReached(address indexed proposedOwner, uint256 readyAt);
    event RecoveryExecuted(address indexed oldOwner, address indexed newOwner);
    event RecoveryCancelled(address indexed proposedOwner, address indexed cancelledBy);
    event GuardianAdded(address indexed guardian);
    event GuardianRemoved(address indexed guardian);
    event RecoveryThresholdUpdated(uint256 newThreshold);
    event Executed(address indexed target, bytes data, bytes result);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyGuardian() {
        require(guardians[msg.sender], "Not guardian");
        _;
    }

    // Guardian-list and threshold changes are blocked while a recovery vote is
    // in flight — otherwise a compromised owner (an attacker who currently
    // holds the key) could remove the very guardians about to recover the
    // wallet from them, defeating the whole point of social recovery.
    modifier noActiveProposal() {
        require(proposedOwner == address(0), "Active recovery proposal");
        _;
    }

    constructor(
        address _owner,
        address[] memory _guardians,
        uint256 _threshold,
        address _ssiRegistry,
        uint256 _recoveryTimelock
    ) {
        require(_owner != address(0), "Zero owner");
        require(_ssiRegistry != address(0), "Zero registry");
        require(_threshold > 0 && _threshold <= _guardians.length, "Invalid threshold");

        owner = _owner;
        ssiRegistry = INeuralHashSSI(_ssiRegistry);
        recoveryTimelock = _recoveryTimelock;

        for (uint i = 0; i < _guardians.length; i++) {
            address guardian = _guardians[i];
            require(guardian != address(0), "Zero guardian");
            require(!guardians[guardian], "Duplicate guardian");

            guardians[guardian] = true;
            guardianList.push(guardian);
        }

        guardianCount = _guardians.length;
        recoveryThreshold = _threshold;
    }

    // ---------------- Credential Linking ----------------
    // Records a pointer to a credential that was issued to *this contract's
    // own address* in NeuralHashSSI (not the owner's raw EOA — see execute()
    // below for why). NeuralHashSSI remains the single source of truth for
    // credential data (hash, CID, issuer, validity); this is a pointer.

    function linkCredential(bytes32 _credentialHash) external onlyOwner {
        require(!isLinkedCredential[_credentialHash], "Already linked");
        require(
            ssiRegistry.verifyCredential(address(this), _credentialHash),
            "Credential not valid for this wallet"
        );

        isLinkedCredential[_credentialHash] = true;
        linkedCredentialHashes.push(_credentialHash);

        emit CredentialLinked(_credentialHash);
    }

    function getLinkedCredentials() external view returns (bytes32[] memory) {
        return linkedCredentialHashes;
    }

    // ---------------- Guardian Management ----------------
    // Owner-managed, mirroring how most social-recovery wallets (e.g. Argent)
    // work: guardians are the owner's own chosen trusted contacts, not a
    // guardian-governed set. Locked while a recovery proposal is active (see
    // noActiveProposal).

    function addGuardian(address _guardian) external onlyOwner noActiveProposal {
        require(_guardian != address(0), "Zero guardian");
        require(!guardians[_guardian], "Already a guardian");

        guardians[_guardian] = true;
        guardianList.push(_guardian);
        guardianCount++;

        emit GuardianAdded(_guardian);
    }

    function removeGuardian(address _guardian) external onlyOwner noActiveProposal {
        require(guardians[_guardian], "Not a guardian");
        require(guardianCount - 1 >= recoveryThreshold, "Would break threshold");

        guardians[_guardian] = false;
        guardianCount--;

        for (uint i = 0; i < guardianList.length; i++) {
            if (guardianList[i] == _guardian) {
                guardianList[i] = guardianList[guardianList.length - 1];
                guardianList.pop();
                break;
            }
        }

        emit GuardianRemoved(_guardian);
    }

    function setRecoveryThreshold(uint256 _threshold) external onlyOwner noActiveProposal {
        require(_threshold > 0 && _threshold <= guardianCount, "Invalid threshold");
        recoveryThreshold = _threshold;

        emit RecoveryThresholdUpdated(_threshold);
    }

    function getGuardians() external view returns (address[] memory) {
        return guardianList;
    }

    // ---------------- Controller Forwarding ----------------
    // This is what makes guardian recovery actually mean something: without
    // it, credentials/interactions issued to *this contract's address* would
    // be unreachable, since only `owner` (an EOA) could ever act as itself —
    // recovering `owner` here would just change who controls an empty shell.
    // With `execute`, the current owner can act *as this contract* against
    // any target (e.g. NeuralHashSSI, InteractionHub), so credentials issued
    // to this contract's address stay reachable across a recovery: whoever
    // becomes `owner` can immediately call through to use them.
    //
    // No reentrancy guard: this only re-exercises the same authority `owner`
    // already has (arbitrary calls as an EOA), it does not grant anything a
    // direct call from `owner` couldn't already do.

    function execute(address target, bytes calldata data)
        external
        onlyOwner
        returns (bytes memory)
    {
        require(target != address(0), "Zero target");
        (bool success, bytes memory result) = target.call(data);
        require(success, "Execution failed");

        emit Executed(target, data, result);
        return result;
    }

    // ---------------- Recovery Logic ----------------
    // Two-step: voteRecovery() reaching threshold only starts a timelock
    // (see recoveryTimelock above); a separate finalizeRecovery() call after
    // it elapses actually transfers ownership. cancelRecovery() lets the
    // current owner abort a recovery they did not authorize at any point
    // before it finalizes.

    function proposeRecovery(address _newOwner) external onlyGuardian {
        require(_newOwner != address(0), "Zero address");
        proposedOwner = _newOwner;
        voteCount = 0;
        recoveryReadyAt = 0;
        _resetGuardianVotes();

        emit RecoveryProposed(_newOwner, msg.sender);
    }

    function voteRecovery() external onlyGuardian {
        require(proposedOwner != address(0), "No proposal");
        require(!guardianVotes[msg.sender], "Already voted");

        guardianVotes[msg.sender] = true;
        voteCount++;

        emit RecoveryVoted(msg.sender, proposedOwner, voteCount);

        if (voteCount >= recoveryThreshold && recoveryReadyAt == 0) {
            recoveryReadyAt = block.timestamp + recoveryTimelock;
            emit RecoveryThresholdReached(proposedOwner, recoveryReadyAt);
        }
    }

    // Permissionless on purpose: by the time this is callable, the outcome
    // is already decided by guardian vote — no extra privilege is needed to
    // execute it, and letting anyone (e.g. the new owner) call it avoids
    // recovery silently stalling because nobody happened to click a button.
    function finalizeRecovery() external {
        require(proposedOwner != address(0), "No proposal");
        require(recoveryReadyAt != 0, "Threshold not reached");
        require(block.timestamp >= recoveryReadyAt, "Timelock not elapsed");

        address oldOwner = owner;
        owner = proposedOwner;
        proposedOwner = address(0);
        voteCount = 0;
        recoveryReadyAt = 0;
        _resetGuardianVotes();

        emit RecoveryExecuted(oldOwner, owner);
    }

    function cancelRecovery() external onlyOwner {
        require(proposedOwner != address(0), "No proposal");
        address cancelledProposedOwner = proposedOwner;

        proposedOwner = address(0);
        voteCount = 0;
        recoveryReadyAt = 0;
        _resetGuardianVotes();

        emit RecoveryCancelled(cancelledProposedOwner, msg.sender);
    }

    function _resetGuardianVotes() private {
        for (uint i = 0; i < guardianList.length; i++) {
            guardianVotes[guardianList[i]] = false;
        }
    }
}
