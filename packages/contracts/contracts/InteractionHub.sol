// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITrustRegistry {
    function isTrusted(address _issuer) external view returns (bool);
}

contract InteractionHub {

    ITrustRegistry public trustRegistry;

    constructor(address _trustRegistry) {
        trustRegistry = ITrustRegistry(_trustRegistry);
    }

    // -----------------------------
    // 🔹 CLAIM REQUEST SYSTEM
    // -----------------------------

    struct ClaimRequest {
        uint256 id;
        address requester;
        address subject;
        string[] requestedFields;
        string purpose;
        bool fulfilled;
        uint256 createdAt;
    }

    uint256 public requestCounter;

    mapping(uint256 => ClaimRequest) public claimRequests;
    mapping(address => uint256[]) public requestsForUser;

    event ClaimRequested(
        uint256 indexed id,
        address indexed requester,
        address indexed subject
    );

    event ClaimFulfilled(
        uint256 indexed id,
        address indexed subject
    );

    function createClaimRequest(
        address subject,
        string[] memory fields,
        string memory purpose
    ) external {

        require(
            trustRegistry.isTrusted(msg.sender),
            "Requester not trusted"
        );

        requestCounter++;

        claimRequests[requestCounter] = ClaimRequest({
            id: requestCounter,
            requester: msg.sender,
            subject: subject,
            requestedFields: fields,
            purpose: purpose,
            fulfilled: false,
            createdAt: block.timestamp
        });

        requestsForUser[subject].push(requestCounter);

        emit ClaimRequested(requestCounter, msg.sender, subject);
    }

    function fulfillClaimRequest(uint256 requestId) external {

        ClaimRequest storage request = claimRequests[requestId];

        require(msg.sender == request.subject, "Not subject");
        require(!request.fulfilled, "Already fulfilled");

        request.fulfilled = true;

        emit ClaimFulfilled(requestId, msg.sender);
    }

    function getRequestsForUser(address user)
        external
        view
        returns (uint256[] memory)
    {
        return requestsForUser[user];
    }

    // -----------------------------
    // 🔹 ATTESTATION SYSTEM
    // -----------------------------

    struct Attestation {
        address attester;
        address subject;
        string statement;
        uint256 createdAt;
    }

    mapping(address => Attestation[]) public attestationsForUser;

    event AttestationCreated(
        address indexed attester,
        address indexed subject,
        string statement
    );

    function createAttestation(
        address subject,
        string memory statement
    ) external {

        require(
            trustRegistry.isTrusted(msg.sender),
            "Attester not trusted"
        );

        attestationsForUser[subject].push(
            Attestation({
                attester: msg.sender,
                subject: subject,
                statement: statement,
                createdAt: block.timestamp
            })
        );

        emit AttestationCreated(msg.sender, subject, statement);
    }

    function getAttestations(address user)
        external
        view
        returns (Attestation[] memory)
    {
        return attestationsForUser[user];
    }
}
