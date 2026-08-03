# Evaluation

All figures below were measured on a local Hardhat network (in-process, deterministic, London-equivalent gas schedule) on 2026-08-03T02:47:37.627Z, not on Sepolia — this gives repeatable, systematic multi-run figures rather than sparse individual testnet transactions. Gas costs are protocol-defined and do not vary between a local Hardhat network and Sepolia for identical bytecode and calldata; wall-clock ZK timings were measured on the developer machine used for this project and will vary by hardware.

## Gas costs by operation

| Operation | Gas used |
|---|---|
| issueCredential | 172,693 |
| issueBatchCredential | 175,560 |
| revokeCredential | 39,649 |
| registerSchema | 262,330 |
| setAgeCommitment | 105,966 |
| createClaimRequest | 261,569 |
| fulfillClaimRequest | 47,772 |
| createAttestation | 145,962 |
| identityDeploy_3guardians | 2,868,623 |
| linkCredential | 112,937 |
| addGuardian | 82,382 |
| removeGuardian | 50,489 |
| proposeRecovery | 69,405 |
| voteRecovery_firstVote | 74,954 |
| voteRecovery_finalVote_reachesThreshold | 81,971 |
| finalizeRecovery | 53,118 |
| cancelRecovery | 47,037 |
| executeForwardedCall | 58,481 |
| submitAgeProof_onChainVerify | 399,451 |

## Batch vs. individual credential issuance

`issueBatchCredential` anchors a single Merkle root representing an arbitrary number of off-chain-hashed credentials in one transaction, whereas `issueCredential` requires one transaction per credential. The table below issues the same N credentials both ways and compares total on-chain gas.

| Credentials (N) | Individual: total gas | Individual: gas/credential | Batch: total gas | Batch: gas/credential | Amortization factor |
|---|---|---|---|---|---|
| 1 | 172,705 | 172,705 | 175,572 | 175,572 | 0.98x |
| 5 | 778,025 | 155,605 | 175,572 | 35,114 | 4.43x |
| 10 | 1,556,026 | 155,603 | 175,572 | 17,557 | 8.86x |
| 25 | 3,890,101 | 155,604 | 175,572 | 7,023 | 22.16x |
| 50 | 7,780,202 | 155,604 | 175,560 | 3,511 | 44.32x |

## ZK age-over-18 proof (Groth16, Poseidon commitment binding)

Measured over 5 runs on the developer machine (Apple Silicon via Rosetta for circom compilation; snarkjs/wasm witness generation and proving run natively):

| Run | Proof generation (ms) | Off-chain verify (ms) |
|---|---|---|
| 1 | 900.8 | 11.3 |
| 2 | 101.7 | 9.9 |
| 3 | 93.7 | 9.7 |
| 4 | 94.6 | 9.2 |
| 5 | 91.3 | 10.1 |

Average proof generation: **256.4 ms**. Average off-chain verification: **10 ms**.
On-chain verification (`AgeVerification.submitAgeProof`, the full credential-bound flow including the commitment-match check against `NeuralHashSSI.getAgeCommitment`): **399,451 gas**.
