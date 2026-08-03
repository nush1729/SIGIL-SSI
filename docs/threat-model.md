# Threat Model

This document gives a structured adversary model for Sigil: what each class
of adversary can and cannot do, and an informal security argument per
property. It is written to the standard expected of a moderately selective
applied-systems venue — informal arguments grounded in the actual contract
code (file/line references given), not machine-checked or formally verified
proofs. Where a property does *not* hold, that is stated as a limitation
rather than omitted.

Contracts referenced: `NeuralHashSSI.sol`, `TrustRegistry.sol`
(`NeuralHashTrustRegistry`), `Identity.sol`, `InteractionHub.sol`,
`SchemaRegistry.sol`, `AgeVerification.sol` — all under
`packages/contracts/contracts/`.

## System roles

- **Registry owner** — the address that deployed `TrustRegistry` and
  `SchemaRegistry`. Centrally trusted: decides which issuers are admitted
  (`setIssuer`), can slash any issuer's stake (`slash`), and is the only
  address that can register or deprecate a credential schema
  (`registerSchema`, `deprecateSchema`).
- **Issuer** — an address the registry owner has marked `isTrusted = true`
  in `TrustRegistry`, after that address staked at least `minimumStake` ETH.
  Can call `issueCredential` / `issueBatchCredential` / `revokeCredential` on
  `NeuralHashSSI`, `setAgeCommitment`, and `createAttestation` on
  `InteractionHub`.
- **Holder** — the subject of a credential; either a raw EOA or the owner of
  an `Identity` guardian-recovery contract.
- **Guardian** — an address a holder's `Identity` owner has added via
  `addGuardian`. Can call `proposeRecovery` / `voteRecovery`.
- **Verifier** — any party checking `NeuralHashSSI.verifyCredential`,
  `verifyBatchInclusion`, or `AgeVerification.isAgeVerified` on-chain, or
  fetching a holder's IPFS-hosted credential JSON off-chain.

## Adversary 1: Malicious or compromised issuer

**Capabilities.** Controls a private key that `TrustRegistry.isTrusted`
returns `true` for. Can call `issueCredential`, `issueBatchCredential`,
`revokeCredential`, `setAgeCommitment` on `NeuralHashSSI`, and
`createAttestation` on `InteractionHub`.

**What this adversary can do.** Issue a credential asserting anything to any
address (`NeuralHashSSI.sol:65-72`) — the contract does not and cannot
validate the semantic truth of off-chain claims (e.g., that a birth date in
the credential JSON is accurate). Anchor an age commitment for a birth year
it never verified (`setAgeCommitment`, `NeuralHashSSI.sol` `AgeCommitmentSet`
handler) — the fix in this iteration binds a ZK proof to *an* issuer's
attested commitment, but does not and cannot verify the issuer did real KYC
before attesting to it. Revoke a credential it issued at any time for any
reason (`revokeCredential`, gated only on `msg.sender` being the original
issuer of that specific credential — `NeuralHashSSI.sol:192` onward), which
can be used maliciously to invalidate a legitimately-earned credential.

**What this adversary cannot do.** Issue or revoke a credential under
another issuer's identity — `issueCredential` records `msg.sender` as
`issuer` (`NeuralHashSSI.sol:97`) and `revokeCredential`/`setAgeCommitment`
both require `msg.sender == creds[i].issuer` for the specific credential
being touched, so one issuer cannot forge or tamper with another issuer's
credentials. Reissue a credential hash that already exists —
`issuedHashes[credentialHash]` is checked and permanently set
(`NeuralHashSSI.sol:91,105`), so an issuer cannot silently overwrite a prior
credential under the same hash. Act as an issuer at all without first
staking `minimumStake` and being explicitly marked trusted by the registry
owner (`TrustRegistry.sol:101-103`) — an untrusted or newly-key-rotated
address is rejected by `onlyTrustedIssuer` (`NeuralHashSSI.sol:55-58`).

**Consequence and mitigation.** A misbehaving issuer's stake is slashable by
the registry owner (`TrustRegistry.sol:68-84`) and its trust can be revoked,
which immediately blocks further issuance/revocation from that address. This
makes misbehavior costly but does not make it *cryptographically*
impossible to issue a false claim — no PKI-external oracle can verify
real-world facts on-chain. This is the same trust assumption every
credential-issuing SSI system makes (the issuer is trusted to tell the
truth); Sigil's contribution is making that trust *economically backed and
revocable on-chain* rather than purely reputational, which Sovrin/Indy,
uPort, and Polygon ID do not enforce at the protocol level (see
[related-work.md](related-work.md)).

## Adversary 2: Malicious or colluding guardians

**Capabilities.** Controls `recoveryThreshold`-or-more of the private keys
an `Identity` owner registered as guardians (`Identity.sol:111-120`).

**What this adversary can do.** Propose and vote through an ownership
change to any address the colluding guardians choose, without the current
owner's consent (`proposeRecovery`/`voteRecovery`, `Identity.sol:180-207`,
both gated only by `onlyGuardian`, never by the owner). Once
`voteCount >= recoveryThreshold`, ownership transfers unconditionally and
immediately in the same transaction (`Identity.sol:198-206`) — there is
**no timelock and no owner-veto window**. This is a real, disclosed
limitation, not a claimed strength: an honest owner has no on-chain
mechanism to detect and cancel a malicious recovery vote in progress before
it completes, short of racing a `removeGuardian`/`setRecoveryThreshold` call
into the same block before the threshold is reached (both of which are
themselves blocked once a proposal is active — `noActiveProposal`,
`Identity.sol:51-54, 111, 122, 140` — so the owner's only real defense is
having picked a guardian set where fewer than `recoveryThreshold` guardians
are simultaneously corruptible).

**What this adversary cannot do.** Act on the identity's credentials or
call `execute()` directly — `execute()` is `onlyOwner`
(`Identity.sol:165-167`), so colluding guardians can change who `owner` is,
but cannot themselves call `execute()` unless and until that ownership
change completes. Add or remove guardians, or change the threshold — those
are `onlyOwner` (`Identity.sol:111,122,140`), so a guardian minority (below
threshold) has no privileged path to entrench itself.

**Consequence and mitigation.** This is the standard trust assumption of
threshold social recovery (also present, unmitigated, in most social-
recovery smart-contract wallets in production, e.g. early Argent): security
reduces to "fewer than `recoveryThreshold` guardians are ever simultaneously
malicious or compromised." Sigil does not add a timelock/challenge-window
mitigation in this iteration; this is named explicitly as future work rather
than left implicit.

## Adversary 3: Compromised owner key (holder-side)

**Capabilities.** Controls the private key currently set as `owner` of an
`Identity` contract, or a holder's raw EOA if they never deployed an
`Identity` contract.

**What this adversary can do (raw EOA holder, no `Identity` contract).**
Nothing can be recovered — an EOA has no guardian mechanism at all, so a
compromised or lost EOA key permanently loses the ability to act on
credentials issued to that address. This is precisely the gap Sigil's
`Identity`/guardian design exists to close (Task #18 in this project's
history), and it is why the frontend steers holders toward linking
credentials to an `Identity` contract's own address rather than their raw
wallet (`packages/web/app/guardian/page.tsx`, "Link a Credential" section).

**What this adversary can do (owner of an `Identity` contract, key
compromised).** Call `execute(target, data)` with arbitrary `target`/`data`
(`Identity.sol:165-176`) — this is deliberately as powerful as the owner
themselves, forwarding any call as the `Identity` contract's own address (see
code comment at `Identity.sol:151-163`: this is what makes recovery
meaningful, since credentials are issued to the contract's address, not the
EOA). An attacker with the owner key can therefore act on every credential
and interaction reachable through `execute()` for as long as they hold the
key. They can also add/remove guardians and change the threshold
(`onlyOwner`, blocked only once a recovery proposal is already active), so a
fast-acting attacker could in principle remove the legitimate guardians
*before* they organize a recovery vote — the `noActiveProposal` guard
protects an in-flight vote, not the window before one starts.

**What this adversary cannot do.** Block a recovery vote once guardians
notice the compromise and start one — `proposeRecovery`/`voteRecovery` are
`onlyGuardian`, not reachable by the owner at all (`Identity.sol:180,189`),
so an attacker holding the compromised owner key cannot cancel or interfere
with an honest guardian-driven recovery in progress (aside from the earlier
race to remove guardians before a proposal exists, above). Forge a
credential as if it were issued by a trusted issuer — `execute()` lets the
attacker *call* `NeuralHashSSI`/`InteractionHub` as the `Identity` contract,
but `issueCredential` still checks `onlyTrustedIssuer` against
`msg.sender` (which would be the `Identity` contract's address, not
generally a trusted issuer) — see `NeuralHashSSI.sol:55-58,65-71`.

**Consequence and mitigation.** Guardian recovery is the mitigation by
design: once guardians detect the compromise (out-of-band, e.g. the real
owner reports the loss), `recoveryThreshold` of them can vote in a new
owner, at which point `execute()` — and therefore every credential and
interaction reachable through the `Identity` contract — is restored to the
legitimate holder. This is verified at the contract level by
`AgeVerification.test.js` / `Identity.test.js` (guardian recovery tests) and
demonstrated end-to-end in the frontend via the "Fulfill via execute()" flow
on the Guardian Wallet page (`packages/web/app/guardian/page.tsx`), not only
exercised from Hardhat scripts.

## Adversary 4: Malicious or careless verifier

**Capabilities.** Any party reading on-chain state or a holder-presented
credential; not a privileged role in this system.

**What this adversary can do.** Misinterpret or ignore
`NeuralHashSSI.verifyCredential`'s return value (e.g., accept a credential
whose `isValid`/expiry checks it never actually ran) — this is a client-side
integration risk, not something the contracts can prevent, since verification
correctness ultimately depends on the verifier's own code calling the view
functions and checking their results. Correlate a holder's on-chain activity
across interactions, since Sigil's holder identifiers are plain Ethereum
addresses, not the pairwise-pseudonymous DIDs Sovrin/Indy use — this is a
privacy limitation, not a verifier attack, but it does mean a verifier (or
any chain observer) can link a holder's credential history, claim requests,
and attestations by address, unlike systems designed around unlinkable
pairwise identifiers.

**What this adversary cannot do.** Forge a passing `verifyCredential` result
for a credential that was never issued or was revoked/expired — `_isLive`
checks `isValid` and `expiresAt` against `block.timestamp`
(`NeuralHashSSI.sol:110-113`) at call time, and there is no verifier-writable
state that affects this check. Forge a passing `AgeVerification.isAgeVerified`
result without a real Groth16 proof over the circuit's public inputs — the
proof is checked by the on-chain `verifier.verifyProof` call before any
state is set (`AgeVerification.sol`, `submitAgeProof`), and the fix in this
iteration additionally requires the proof's public commitment to match one a
specific issuer anchored for a specific credential
(`expectedCommitment == publicSignals[0]`), closing the earlier gap where a
holder could submit a self-attested proof for any birth year with no issuer
involved at all.

## Summary table

| Property | Holds against | Does not hold against | Where enforced |
|---|---|---|---|
| Only a staked, registry-approved address can issue/revoke a given credential | Any non-issuer, any other issuer | The registry owner (fully trusted), a compromised issuer key | `TrustRegistry.sol:47-118`, `NeuralHashSSI.sol:55-58,65-72,192+` |
| A ZK age proof cannot be generated for a birth year no issuer attested to | Any holder without issuer cooperation | A colluding/malicious issuer that anchors a false commitment | `NeuralHashSSI.sol` (`setAgeCommitment`), `AgeVerification.sol` (`submitAgeProof`) |
| Recovering a lost owner key restores access to credentials issued to the wallet | Guardians ≥ threshold, honest majority | < threshold honest guardians (collusion), no timelock on votes | `Identity.sol:165-207`, demonstrated in `packages/web/app/guardian/page.tsx` |
| Credential hashes/schemas cannot be tampered with post-issuance | Any third party, any other issuer | The registry owner (can slash/de-trust, cannot rewrite history) | `NeuralHashSSI.sol` (`issuedHashes` set-once), `SchemaRegistry.sol` (`onlyOwner`) |
| Holder identity is unlinkable across interactions | *(does not hold — named limitation)* | Any on-chain observer | Not enforced; addresses are plain Ethereum addresses, unlike Sovrin/Indy pairwise DIDs |
| A malicious owner-key holder can be locked out again by guardians | Honest guardian majority | A fast attacker who removes guardians before a proposal starts | `Identity.sol:111-138` (`noActiveProposal` protects only in-flight proposals) |

## Explicitly out of scope

- **Smart contract layer attacks below the Solidity level** (e.g. EVM
  reentrancy beyond what's discussed above, front-running/MEV on
  `issueCredential`/`slash`/recovery transactions, gas-griefing) are not
  formally analyzed here. `execute()`'s lack of a reentrancy guard is
  addressed informally in a code comment (`Identity.sol:161-163`): it only
  re-exercises authority the owner already has, so it introduces no
  privilege escalation, but a full MEV/front-running analysis (e.g. can a
  third party front-run a `voteRecovery` to grief gas costs) was not
  performed.
- **Off-chain infrastructure**: IPFS gateway availability/censorship, the
  Next.js API routes that compute ZK witnesses server-side (a disclosed
  privacy trade-off — see the code comment in
  `packages/web/app/api/zk/prove-age/route.ts` — birth year is visible to
  that server process for the duration of the request), and wallet/browser
  security are not modeled.
- **The Groth16 trusted setup**: this project reuses a public
  Powers-of-Tau ceremony rather than running a fresh multi-party
  ceremony for the `AgeOver18` circuit's phase-2 contribution. A
  compromised or colluding-majority ceremony could in principle allow a
  false proof to verify; this is a standard, disclosed limitation of reusing
  a public ceremony rather than a property this project independently
  re-establishes.
