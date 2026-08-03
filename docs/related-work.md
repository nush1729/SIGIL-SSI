# Related Work

Sigil is a smart-contract-based self-sovereign identity (SSI) system on Ethereum:
credentials are hashed and anchored on-chain (`NeuralHashSSI`), issuers are
admitted and economically bonded through on-chain staking (`TrustRegistry`),
holders can optionally deploy a guardian-recovery smart contract wallet
(`Identity`) so that losing a key does not mean losing access to credentials
issued to that wallet, and a Groth16 circuit lets a holder prove an
issuer-attested age predicate (`>= 18`) without revealing a birth date. This
section positions those design choices against the systems most often cited
in SSI literature and practice.

## Ledger-anchored identity networks: Sovrin and Hyperledger Indy/Aries

Sovrin is a public-permissioned distributed ledger purpose-built for
self-sovereign identity, governed by the non-profit Sovrin Foundation and
operated by vetted "Stewards" running validator nodes; it implements privacy
by design through pairwise-pseudonymous DIDs, peer-to-peer agents, and
selective disclosure via zero-knowledge proofs (Windley, "Sovrin: An Identity
Metasystem for Self-Sovereign Identity," *Frontiers in Blockchain*, vol. 4,
2021, doi:10.3389/fbloc.2021.626726). Hyperledger Indy provides the
ledger and DID/credential-definition/revocation-registry primitives that
Sovrin and similar networks are built on, while Hyperledger Aries supplies
the agent-to-agent DIDComm protocol layer, wallets, and issuer/holder/verifier
roles on top of it (Hyperledger Aries project, hyperledger-aries/aries;
see also the survey in Doe et al., "A Survey on Decentralized Identifiers and
Verifiable Credentials," arXiv:2402.02455, 2024).

The key architectural difference is *where credential data lives*. In
Indy/Aries, the ledger stores only schemas, credential definitions, and
revocation registries — the credentials themselves are never written to the
ledger, and are exchanged directly between issuer and holder agents over
DIDComm. This is deliberately more private than Sigil's design: Sigil writes
a `keccak256` hash of each credential (or a Merkle root for a batch) to a
public Ethereum contract, which is a permanent, unlinkable-only-if-the-holder-
never-reuses-hashes on-chain footprint. Sigil trades some of that
ledger-level privacy for something Indy/Aries does not have natively:
economic accountability. Trust in an Indy/Aries network is established
out-of-band through legal "trust frameworks" and steward vetting; Sigil's
`TrustRegistry` instead requires an issuer to stake ETH before it can issue
credentials, and that stake is slashable, so misbehavior has an automatic,
on-chain economic consequence rather than only a governance one. Sigil is
also deployed on a permissionless public chain (Ethereum/Sepolia) rather than
a permissioned identity-specific ledger, which lowers the barrier to
running or auditing an issuer but forgoes Indy/Aries's ledger-level
governance and consent mechanisms.

## uPort

uPort, developed at ConsenSys starting in 2016, was one of the first
Ethereum-based self-sovereign identity systems: a user's identity is a proxy
smart contract on Ethereum, with off-chain claims signed by the user's keys
and later contributing to what became the ERC-1056 lightweight-identity and
ERC-780 claims-registry standards (uPort whitepaper, "uPort: A Platform for
Self-Sovereign Identity," draft, 2016-10-20; see also the later academic
analysis in "Analysis of uPort Open, an Identity Management Blockchain-Based
Solution," *Trust, Privacy and Security in Digital Business*, Springer, 2020,
doi:10.1007/978-3-030-58986-8_1). Sigil shares uPort's basic bet — identity
and credential state anchored in Ethereum smart contracts rather than a
purpose-built ledger — but goes further in two respects uPort's original
design did not address: uPort had no on-chain issuer-trust or staking
mechanism (any address could self-assert claims about another), and no
guardian-based social recovery tied to credential continuity. Sigil's
`TrustRegistry` gates who may issue, and its `Identity` contract's guardian
recovery plus `execute()` forwarding is designed specifically so that
recovering a lost key also recovers the ability to act on credentials issued
to that identity — a gap common to early proxy-contract identity designs.

## Polygon ID and zCloak Network

Polygon ID (now largely continued as Privado ID) and zCloak Network are the
closest systems to Sigil's ZK component in intent: both let a holder prove a
predicate about a credential attribute without revealing the underlying
value, using zero-knowledge proofs (Polygon ID: "Introducing Polygon ID,
Zero-Knowledge Identity for Web3," Polygon Labs blog, 2022, and the Identity
Foundation guest post at blog.identity.foundation/guest-blog-polygon-id;
zCloak Network: zcloak.network/about, and its Valid ID / zkID Wallet
products). Both are considerably more general than Sigil's ZK component:
Polygon ID uses the iden3 protocol's sparse Merkle identity-state trees and a
query language that can express arbitrary predicates over arbitrary
credential schemas, verified either off-chain or via an on-chain
verifier SDK; zCloak computes proofs (zk-STARKs in their more recent
products) client-side over arbitrary DID-linked verifiable credentials and
publishes results through an oracle to multiple chains. Sigil implements a
single, narrow circuit — Groth16 over a Poseidon commitment to
`(birthYear, salt)`, proving `currentYear - birthYear >= 18` — rather than a
general predicate-proof framework. What Sigil adds relative to a naive
self-attested age proof (and what an early version of this project lacked)
is binding: the Poseidon commitment used in the proof must match a
commitment the issuer anchored on-chain against a specific credential hash
(`NeuralHashSSI.setAgeCommitment`, checked in
`AgeVerification.submitAgeProof`), so a holder cannot generate a valid proof
for a birth year no issuer ever attested to. This closes the same class of
gap Polygon ID and zCloak address by tying ZK proofs to issuer-signed
identity state, but Sigil does so for one hard-coded predicate rather than a
general query language — a scope difference, not a claimed advance over
either system's generality.

## evan.network

evan.network is an enterprise-oriented blockchain platform built around
self-sovereign digital identities and "digital twins" — on-chain,
cryptographically secured representations of business assets or entities,
with encrypted, owner-controlled data sharing (evan.network / evan GmbH,
Medium publications on evan.network, 2018-2020). Its self-sovereign identity
component is conceptually aligned with Sigil's holder-controls-disclosure
principle, but it targets B2B supply-chain and asset-provenance use cases
built on a permissioned Ethereum fork, not individual holder credentials or
ZK predicate proofs, and staking/slashing-based issuer accountability is not
part of its published design. It is included here as a comparable
"self-sovereign identity on an Ethereum-family chain" system rather than a
close technical relative.

## W3C Decentralized Identifiers and Verifiable Credentials

The W3C Decentralized Identifiers (DIDs) v1.0 Recommendation (19 July 2022)
and the Verifiable Credentials Data Model v2.0 Recommendation (15 May 2025)
define the standards most SSI literature treats as the interoperability
baseline: a DID is a URI that resolves to a DID document describing
verification methods and service endpoints, and a verifiable credential is a
signed, tamper-evident claim set expressed as JSON-LD or a similarly
structured, cryptographically provable data model (W3C, "Decentralized
Identifiers (DIDs) v1.0," w3.org/TR/did-1.0/; W3C, "Verifiable Credentials
Data Model v2.0," w3.org/TR/vc-data-model-2.0/). **Sigil does not currently
implement either specification.** Holder identifiers in Sigil are Ethereum
addresses (optionally an `Identity` contract address for guardian-recoverable
holders), not W3C-conformant DIDs with a resolvable DID document, and
credentials are represented as an application-defined JSON document pinned
to IPFS with its hash anchored on-chain, not a VC Data Model object with a
standard proof suite. This is a genuine scoping limitation relative to
Sovrin/Indy/Aries, Polygon ID, and zCloak, all of which are built around
W3C DIDs and/or VCs as their wire format — Sigil optimizes instead for a
minimal, fully on-chain-verifiable trust and recovery layer, at the cost of
standards interoperability. Adopting DID methods and VC Data Model
serialization for Sigil's credential documents is the most direct path to
closing this gap and is noted as future work rather than claimed as done.

## Summary positioning

| System | Ledger/chain | Credential storage | Issuer accountability | ZK predicate proofs | Guardian/social recovery tied to credentials | W3C DID/VC conformant |
|---|---|---|---|---|---|---|
| Sovrin / Hyperledger Indy+Aries | Permissioned, identity-purpose-built | Off-ledger (agent-to-agent) | Governance/trust-framework (off-chain) | Yes (CL signatures / Indy's native ZK) | Not native to the protocol | Yes |
| uPort | Public Ethereum | On-chain proxy contract + off-chain claims | None (any address can assert) | No | No | Partial (ERC-1056 predates DID v1.0) |
| Polygon ID / Privado ID | Public Ethereum-family (Polygon) | Off-chain, issuer-signed, holder-held | Issuer reputation, not staked | Yes, general query language | No | Yes |
| zCloak Network | Substrate-based | Off-chain, client-side computed | Not staked | Yes (zk-STARK) | No | Yes |
| evan.network | Permissioned Ethereum fork | On-chain "digital twins" | Not staked | No | No | Partial |
| **Sigil (this work)** | Public Ethereum (Sepolia) | On-chain hash / Merkle root | **On-chain staking + slashing** | Yes, single hard-coded predicate, issuer-bound | **Yes, via `Identity.execute()` forwarding** | **No (scoping limitation, future work)** |

Sigil's distinguishing combination is on-chain economic issuer accountability
plus guardian-recovery that provably restores credential access, evaluated
together on a public chain; its clearest limitation relative to the systems
above is the lack of W3C DID/VC conformance and the narrowness of its ZK
predicate compared to general-purpose frameworks like Polygon ID's.
