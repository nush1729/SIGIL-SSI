# Sigil

A Self-Sovereign Identity (SSI) proof-of-concept on Ethereum Sepolia — credential
issuance with on-chain issuer staking, Merkle-batch anchoring with verifiable
inclusion proofs, a guardian-recovery smart wallet that actually survives
recovery, and a zero-knowledge age-over-18 predicate proof. Built as an
academic project; **not audited, not production-ready.**

## Monorepo layout

```
packages/
  contracts/   Hardhat project — Solidity contracts, tests, deploy scripts
  web/         Next.js frontend — issuer/verifier/interactions/guardian dashboards
  zk/          circom circuit + Groth16 trusted setup for age-over-18 proofs
```

## What's actually implemented

| Capability | Status |
|---|---|
| Credential issuance, gated to trusted + staked issuers | ✅ `TrustRegistry.isTrusted` enforced in `NeuralHashSSI.issueCredential`; trust requires the issuer to have staked ETH first |
| Issuer staking + slashing | ✅ `TrustRegistry.depositStake/withdrawStake/slash` — trust is real collateral, not just an admin flag; a misbehaving issuer's stake can be slashed and their trust revoked in one call |
| Credential revocation (issuer-only) | ✅ |
| Expiring credentials | ✅ optional `expiresAt` at issuance time, enforced in `verifyCredential`/`verifyBatchInclusion` |
| Merkle-batch credential anchoring | ✅ `issueBatchCredential` |
| **On-chain** Merkle inclusion verification | ✅ `verifyBatchInclusion`, using OpenZeppelin's `MerkleProof`, called from the Verifier Portal |
| Guardian-based social recovery smart wallet (`Identity.sol`) | ✅ deployable and usable from the Guardian Wallet page; guardian threshold validated at deploy time |
| **Recovery that actually restores credential access** | ✅ `Identity.execute()` lets whoever currently owns the wallet act *as* the Identity contract's own address — so credentials issued to that address (not a raw EOA) stay reachable across a guardian recovery. Verified live with two full recovery rounds on Sepolia, and exercised from the frontend itself (not only scripts) via the Guardian Wallet page's "Fulfill via execute()" flow. |
| Guardian add/remove + threshold updates | ✅ owner-managed, blocked while a recovery vote is active (so a compromised owner can't eject the guardians about to recover the wallet) |
| Credential ⇄ Identity cross-reference | ✅ `Identity.linkCredential` checks the credential is genuinely valid for the Identity contract's own address in `NeuralHashSSI` before linking — one canonical credential store, not two |
| Zero-knowledge age-over-18 predicate proof | ✅ circom + snarkjs Groth16 circuit, on-chain verifier (`AgeVerification.sol`), proves `currentYear - birthYear >= 18` from a private Poseidon commitment without ever revealing the birth year on-chain |
| **ZK proof bound to an issuer-attested credential** | ✅ the Poseidon commitment used in the proof must match one the issuer anchored on-chain for a specific credential (`NeuralHashSSI.setAgeCommitment`, checked in `AgeVerification.submitAgeProof`) — a holder cannot prove an age no issuer ever attested to |
| On-chain schema registry | ✅ `SchemaRegistry.sol` — versioned document-type/field definitions, replacing a hardcoded frontend constant as the source of truth |
| Verifiable presentations | ✅ bundle several (single, non-batch) credentials into one shareable IPFS document; a verifier independently re-verifies every entry on-chain, not just trusts the bundle |
| Peer-to-peer claim requests & attestations | ✅ `InteractionHub.sol`, gated to trusted requesters |
| IPFS storage (Pinata) | ✅ credential documents, batch payloads, and presentations |
| Document OCR/extraction | ✅ Google Gemini, used to prefill credential fields from an uploaded PDF |
| WebAuthn biometric gate | ✅ local, device-side gate before issuance, revocation, selective disclosure, and guardian-recovery propose/vote (not a server-verified authentication factor — see Known Limitations) |
| On-chain analytics (gas, tx volume) | ✅ via Etherscan API |
| Third-party audit | ❌ not performed |
| USD cost estimate *before* a transaction is submitted | ❌ not implemented (removed from claims; a post-hoc gas summary is shown after issuance) |

## Setup

### 1. Prerequisites
- Node.js 20+
- [pnpm](https://pnpm.io) (`npm install -g pnpm`)
- MetaMask (or another wallet), with a Sepolia testnet account
- (Only if you want to rebuild the ZK circuit — not needed to just run the app) `circom` — see `packages/zk/`

### 2. Install

```bash
pnpm install
```

### 3. Configure environment

Copy the example env files and fill them in:

```bash
cp packages/contracts/.env.example packages/contracts/.env
cp packages/web/.env.example packages/web/.env.local
```

See each file's comments for what every variable is for and where to get it —
every external service used (Etherscan, Pinata, Google Gemini, WalletConnect
Cloud) has a sufficient free tier for this project; nothing here requires a
paid plan.

### 4. Compile & test the contracts

```bash
pnpm --filter sigil-contracts run compile
pnpm --filter sigil-contracts run test
```

`compile` also regenerates the frontend's ABI files under `packages/web/app/abi/`
directly from the Hardhat build artifacts, so the frontend can never drift
from the deployed contracts' real interface.

### 5. Deploy to Sepolia

```bash
pnpm --filter sigil-contracts run deploy:sepolia
```

This deploys `TrustRegistry → NeuralHashSSI → InteractionHub → SchemaRegistry
→ AgeOver18Groth16Verifier → AgeVerification`, in that order; stakes and
trusts the deployer wallet as an issuer; registers the frontend's document
schemas on-chain; and prints every address. Copy them into
`packages/web/.env.local` (`NEXT_PUBLIC_SSI_ADDRESS`,
`NEXT_PUBLIC_TRUSTREGISTRY_ADDRESS`, `NEXT_PUBLIC_INTERACTIONHUB_ADDRESS`,
`NEXT_PUBLIC_SCHEMA_REGISTRY_ADDRESS`, `NEXT_PUBLIC_AGE_VERIFICATION_ADDRESS`).

`Identity` (the guardian wallet) has no single address — each user deploys
their own instance from the app's Guardian Wallet page.

### 6. Live smoke tests against your deployment (optional but recommended)

```bash
pnpm --filter sigil-contracts run test:sepolia:live       # issuance, expiry, batch, revoke, claims, attestations
pnpm --filter sigil-contracts run test:sepolia:guardian   # guardian wallet, 2 full recovery rounds, guardian mgmt
```

These send real transactions with real (small) gas cost, using the deployer
wallet plus throwaway wallets generated and funded on the fly.

### 7. Run the frontend

```bash
pnpm --filter sigil-web run dev
```

Open http://localhost:3000, connect a Sepolia wallet, and pick a workspace
(Issuer / Verifier / Interactions / Guardian Wallet).

## Contracts

| Contract | Purpose |
|---|---|
| `TrustRegistry.sol` (`NeuralHashTrustRegistry`) | Owner-managed, stake-gated allowlist of trusted issuers; slashing |
| `NeuralHashSSI.sol` | Canonical credential store — issuance (single + Merkle-batch), expiry, revocation, on-chain Merkle inclusion verification |
| `InteractionHub.sol` | Peer-to-peer claim requests and attestations between trusted parties |
| `Identity.sol` | Per-user guardian-recovery smart wallet; `execute()` lets it act as its own address so recovery restores credential access; links to credentials the wallet actually holds in `NeuralHashSSI`; guardian add/remove |
| `SchemaRegistry.sol` | On-chain, versioned document schema definitions |
| `AgeVerification.sol` + `AgeOver18Groth16Verifier.sol` | Wraps an auto-generated Groth16 verifier with on-chain state (`isAgeVerified(address)`) |

## Zero-knowledge age verification

`packages/zk/circuits/AgeOver18.circom` proves `currentYear - birthYear >= 18`
given a private `(birthYear, salt)` pair whose Poseidon commitment is public.
The verifier only ever sees the commitment and a boolean result — never the
birth year. Proof generation currently happens server-side
(`/api/zk/prove-age`) for reliability within this project's scope; a
production deployment should generate the proof fully client-side via
snarkjs's browser build so the birth year never leaves the user's device at
all. This trade-off is disclosed, not hidden.

## Known limitations (by design, for this project's scope)

- WebAuthn biometric checks are a local UX gate on sensitive frontend actions, not a server-verified signature checked on-chain.
- Verifiable presentations are scoped to single (non-batch) credentials — a batch credential's Merkle leaf/proof isn't retained in a form the presentation bundler can look up outside the original batch's IPFS payload.
- ZK proof generation is server-side in this build (see above) — a real privacy guarantee would move it fully client-side.
- Not W3C DID / Verifiable Credentials Data Model conformant — holder identifiers are Ethereum addresses and credentials are an application-defined JSON document + on-chain hash, not standard DID documents / VC objects. See [docs/related-work.md](docs/related-work.md) for the comparison this implies.
- Guardian recovery has no timelock or owner-veto window — see [docs/threat-model.md](docs/threat-model.md) for the full adversary analysis, including this one.

## Further documentation

- [docs/related-work.md](docs/related-work.md) — positioning against Sovrin, Hyperledger Indy/Aries, uPort, Polygon ID, zCloak, evan.network, and the W3C DID/VC specs.
- [docs/threat-model.md](docs/threat-model.md) — structured adversary model (malicious issuer, colluding guardians, compromised owner key, malicious verifier) with informal security arguments per property.
- [docs/evaluation.md](docs/evaluation.md) — real gas costs, batch-issuance amortization, and ZK proof gen/verify timing, measured on a local Hardhat network (raw data in `docs/benchmark-results.json`, reproducible via `packages/contracts/scripts/benchmark.js`).
- No third-party security audit.
