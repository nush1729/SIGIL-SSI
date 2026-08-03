// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";

interface ITrustRegistry {
    function isTrusted(address _issuer) external view returns (bool);
}

contract NeuralHashSSI {

    struct Credential {
        bytes32 credentialHash; // for batch credentials, this is the Merkle root
        string ipfsCID;
        address issuer;
        bool isValid;
        uint256 issuedAt;
        bool isBatch;
        uint256 expiresAt; // 0 = never expires
    }

    ITrustRegistry public immutable trustRegistry;

    mapping(address => Credential[]) private userCredentials;
    mapping(bytes32 => bool) private issuedHashes;

    // Binds a ZK age-predicate commitment (Poseidon(birthYear, salt), as a
    // BN254 scalar field element) to a specific credential the issuer
    // actually issued — so a ZK proof against this commitment means "the
    // issuer attested to this birth year on this credential," not just "the
    // holder typed some birth year into a form." Settable once, by the
    // credential's original issuer only. 0 = not set.
    mapping(bytes32 => uint256) private ageCommitments;

    event CredentialIssued(
        address indexed user,
        bytes32 indexed credentialHash,
        string ipfsCID,
        address indexed issuer,
        bool isBatch,
        uint256 expiresAt
    );

    event CredentialRevoked(
        address indexed user,
        bytes32 indexed credentialHash
    );

    event AgeCommitmentSet(
        address indexed user,
        bytes32 indexed credentialHash,
        uint256 commitment
    );

    modifier onlyTrustedIssuer() {
        require(trustRegistry.isTrusted(msg.sender), "Issuer not trusted");
        _;
    }

    constructor(address _trustRegistry) {
        require(_trustRegistry != address(0), "Zero address");
        trustRegistry = ITrustRegistry(_trustRegistry);
    }

    function issueCredential(
        address user,
        bytes32 credentialHash,
        string calldata ipfsCID,
        uint256 expiresAt
    ) external onlyTrustedIssuer {
        _issue(user, credentialHash, ipfsCID, false, expiresAt);
    }

    // credentialHash here is the Merkle root of a batch of off-chain-hashed credentials.
    function issueBatchCredential(
        address user,
        bytes32 merkleRoot,
        string calldata ipfsCID,
        uint256 expiresAt
    ) external onlyTrustedIssuer {
        _issue(user, merkleRoot, ipfsCID, true, expiresAt);
    }

    function _issue(
        address user,
        bytes32 credentialHash,
        string calldata ipfsCID,
        bool isBatch,
        uint256 expiresAt
    ) private {
        require(!issuedHashes[credentialHash], "Already issued");
        require(expiresAt == 0 || expiresAt > block.timestamp, "Invalid expiry");

        userCredentials[user].push(
            Credential({
                credentialHash: credentialHash,
                ipfsCID: ipfsCID,
                issuer: msg.sender,
                isValid: true,
                issuedAt: block.timestamp,
                isBatch: isBatch,
                expiresAt: expiresAt
            })
        );

        issuedHashes[credentialHash] = true;

        emit CredentialIssued(user, credentialHash, ipfsCID, msg.sender, isBatch, expiresAt);
    }

    function _isLive(Credential memory cred) private view returns (bool) {
        return cred.isValid && (cred.expiresAt == 0 || cred.expiresAt > block.timestamp);
    }

    function verifyCredential(
        address user,
        bytes32 credentialHash
    ) external view returns (bool) {
        Credential[] memory creds = userCredentials[user];

        for (uint i = 0; i < creds.length; i++) {
            if (creds[i].credentialHash == credentialHash && _isLive(creds[i])) {
                return true;
            }
        }
        return false;
    }

    // Verifies that `leaf` is included in a Merkle-batch credential previously
    // anchored for `user` under root `credentialHash`, and that the batch is
    // still valid (not revoked or expired).
    function verifyBatchInclusion(
        address user,
        bytes32 credentialHash,
        bytes32 leaf,
        bytes32[] calldata proof
    ) external view returns (bool) {
        Credential[] memory creds = userCredentials[user];

        for (uint i = 0; i < creds.length; i++) {
            if (
                creds[i].credentialHash == credentialHash &&
                creds[i].isBatch &&
                _isLive(creds[i])
            ) {
                return MerkleProof.verify(proof, credentialHash, leaf);
            }
        }
        return false;
    }

    function getUserCredentials(address user)
        external
        view
        returns (Credential[] memory)
    {
        return userCredentials[user];
    }

    // Lets the original issuer of `credentialHash` anchor a ZK age-predicate
    // commitment against it, one time. Typically called right after issuing
    // a credential that carries a date-of-birth field, using a commitment
    // the issuer computed over the same value it just extracted/verified
    // from the source document. This is what AgeVerification checks against
    // — closing the gap where a ZK proof could be generated for an
    // arbitrary, unattested birth year.
    function setAgeCommitment(
        address user,
        bytes32 credentialHash,
        uint256 commitment
    ) external {
        require(commitment != 0, "Zero commitment");
        require(ageCommitments[credentialHash] == 0, "Already set");

        Credential[] memory creds = userCredentials[user];
        for (uint i = 0; i < creds.length; i++) {
            if (creds[i].credentialHash == credentialHash) {
                require(msg.sender == creds[i].issuer, "Only issuer");
                ageCommitments[credentialHash] = commitment;
                emit AgeCommitmentSet(user, credentialHash, commitment);
                return;
            }
        }

        revert("Not found");
    }

    function getAgeCommitment(bytes32 credentialHash) external view returns (uint256) {
        return ageCommitments[credentialHash];
    }

    function revokeCredential(
        address user,
        bytes32 credentialHash
    ) external {
        Credential[] storage creds = userCredentials[user];

        for (uint i = 0; i < creds.length; i++) {
            if (creds[i].credentialHash == credentialHash) {
                require(
                    msg.sender == creds[i].issuer,
                    "Only issuer"
                );
                creds[i].isValid = false;
                emit CredentialRevoked(user, credentialHash);
                return;
            }
        }

        revert("Not found");
    }
}
