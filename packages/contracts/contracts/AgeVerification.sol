// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAgeOver18Groth16Verifier {
    function verifyProof(
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[2] calldata publicSignals
    ) external view returns (bool);
}

interface INeuralHashSSIForAge {
    function verifyCredential(address user, bytes32 credentialHash) external view returns (bool);
    function getAgeCommitment(bytes32 credentialHash) external view returns (uint256);
}

// Wraps the auto-generated Groth16 verifier with on-chain state, and — this
// is the part that closes the credential-binding gap — requires the proof's
// public commitment to match a commitment the credential's *original
// issuer* anchored via NeuralHashSSI.setAgeCommitment. Without this check,
// a proof only shows "the caller knows some (birthYear, salt) satisfying
// the arithmetic," which anyone can produce for a fabricated birth year.
// With it, a proof shows "the caller knows the preimage of a commitment a
// trusted issuer specifically attested to on a credential that is still
// valid" — i.e., it's bound to a real, revocable, expirable credential, not
// a free-floating self-attestation.
contract AgeVerification {

    IAgeOver18Groth16Verifier public immutable verifier;
    INeuralHashSSIForAge public immutable ssiRegistry;

    mapping(address => bool) public isAgeVerified;
    mapping(address => uint256) public verifiedAtYear;
    mapping(address => uint256) public commitmentUsed;
    mapping(address => bytes32) public credentialUsed;

    event AgeVerified(
        address indexed user,
        bytes32 indexed credentialHash,
        uint256 commitment,
        uint256 currentYear
    );

    constructor(address _verifier, address _ssiRegistry) {
        require(_verifier != address(0), "Zero verifier");
        require(_ssiRegistry != address(0), "Zero registry");
        verifier = IAgeOver18Groth16Verifier(_verifier);
        ssiRegistry = INeuralHashSSIForAge(_ssiRegistry);
    }

    // publicSignals = [commitment, currentYear], matching the circuit's
    // `component main {public [commitment, currentYear]}` output order.
    function submitAgeProof(
        bytes32 credentialHash,
        uint256[2] calldata pA,
        uint256[2][2] calldata pB,
        uint256[2] calldata pC,
        uint256[2] calldata publicSignals
    ) external {
        require(ssiRegistry.verifyCredential(msg.sender, credentialHash), "Credential not valid");

        uint256 expectedCommitment = ssiRegistry.getAgeCommitment(credentialHash);
        require(expectedCommitment != 0, "No age commitment on this credential");
        require(expectedCommitment == publicSignals[0], "Commitment does not match credential");

        require(verifier.verifyProof(pA, pB, pC, publicSignals), "Invalid proof");

        isAgeVerified[msg.sender] = true;
        verifiedAtYear[msg.sender] = publicSignals[1];
        commitmentUsed[msg.sender] = publicSignals[0];
        credentialUsed[msg.sender] = credentialHash;

        emit AgeVerified(msg.sender, credentialHash, publicSignals[0], publicSignals[1]);
    }
}
