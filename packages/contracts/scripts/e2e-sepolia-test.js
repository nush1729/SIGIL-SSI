// Live end-to-end smoke test against a deployed Sepolia stack. Uses the
// signer wallet (must already be a trusted issuer) to exercise every fixed
// code path with real transactions: single issuance, expiring credentials,
// Merkle-batch issuance + on-chain inclusion verification, revocation, and
// the InteractionHub claim-request/attestation lifecycle.
//
// Defaults point at this project's current Sepolia deployment; override via
// env vars if you redeploy.
require("dotenv").config();
const { ethers } = require("hardhat");

const SSI_ADDRESS =
  process.env.SSI_REGISTRY_ADDRESS || "0xa9025B3065785aEdb2Ac08017cF1a6F943deAfd3";
const TRUST_REGISTRY_ADDRESS =
  process.env.TRUST_REGISTRY_ADDRESS || "0xaA9C23E2a650A44E364B3A13Aad662a2F6Bf5f93";
const INTERACTION_HUB_ADDRESS =
  process.env.INTERACTION_HUB_ADDRESS || "0x5E5DDb065F557cf33E4a700fED31119171f9f66b";

const NO_EXPIRY = 0;

function hashPair(a, b) {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using wallet:", signer.address);

  const ssi = await (await ethers.getContractFactory("NeuralHashSSI")).attach(SSI_ADDRESS);
  const trustRegistry = await (
    await ethers.getContractFactory("NeuralHashTrustRegistry")
  ).attach(TRUST_REGISTRY_ADDRESS);
  const hub = await (
    await ethers.getContractFactory("InteractionHub")
  ).attach(INTERACTION_HUB_ADDRESS);

  section("Pre-flight: trust check");
  const trusted = await trustRegistry.isTrusted(signer.address);
  console.log("isTrusted(signer):", trusted);
  if (!trusted) throw new Error("Signer is not a trusted issuer — aborting.");

  section("1. Issue a single credential (never expires)");
  const singleCredential = { type: "Degree", name: "E2E Test", year: 2026, nonce: Date.now() };
  const singleHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(singleCredential)));
  let tx = await ssi.issueCredential(signer.address, singleHash, "e2e-test-cid-single", NO_EXPIRY);
  let receipt = await tx.wait();
  console.log("issueCredential tx:", receipt.hash, "block", receipt.blockNumber);

  const verifiedSingle = await ssi.verifyCredential(signer.address, singleHash);
  console.log("verifyCredential(single):", verifiedSingle);

  section("2. Issue an expiring credential and confirm it's live now");
  const expiringCredential = { type: "TempPass", name: "E2E Expiring Test", nonce: Date.now() };
  const expiringHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(expiringCredential)));
  const block = await ethers.provider.getBlock("latest");
  const expiresAt = block.timestamp + 3600; // 1 hour from now
  tx = await ssi.issueCredential(signer.address, expiringHash, "e2e-test-cid-expiring", expiresAt);
  receipt = await tx.wait();
  console.log("issueCredential (expiring) tx:", receipt.hash, "block", receipt.blockNumber);
  console.log(
    "verifyCredential(expiring, not yet expired):",
    await ssi.verifyCredential(signer.address, expiringHash)
  );

  section("3. Issue a Merkle-batch credential + verify inclusion on-chain");
  const leafA = ethers.keccak256(ethers.toUtf8Bytes(`e2e-leaf-a-${Date.now()}`));
  const leafB = ethers.keccak256(ethers.toUtf8Bytes(`e2e-leaf-b-${Date.now()}`));
  const root = hashPair(leafA, leafB);

  tx = await ssi.issueBatchCredential(signer.address, root, "e2e-test-cid-batch", NO_EXPIRY);
  receipt = await tx.wait();
  console.log("issueBatchCredential tx:", receipt.hash, "block", receipt.blockNumber);

  const includedA = await ssi.verifyBatchInclusion(signer.address, root, leafA, [leafB]);
  const includedB = await ssi.verifyBatchInclusion(signer.address, root, leafB, [leafA]);
  const notIncluded = await ssi.verifyBatchInclusion(
    signer.address,
    root,
    ethers.keccak256(ethers.toUtf8Bytes("not-in-tree")),
    [leafB]
  );
  console.log("verifyBatchInclusion(leafA):", includedA);
  console.log("verifyBatchInclusion(leafB):", includedB);
  console.log("verifyBatchInclusion(unrelated leaf, expect false):", notIncluded);

  section("4. Revoke the single credential");
  tx = await ssi.revokeCredential(signer.address, singleHash);
  receipt = await tx.wait();
  console.log("revokeCredential tx:", receipt.hash, "block", receipt.blockNumber);

  const verifiedAfterRevoke = await ssi.verifyCredential(signer.address, singleHash);
  console.log("verifyCredential(single) after revoke (expect false):", verifiedAfterRevoke);

  section("5. InteractionHub: claim request lifecycle");
  tx = await hub.createClaimRequest(signer.address, ["type", "year"], "e2e self-test");
  receipt = await tx.wait();
  console.log("createClaimRequest tx:", receipt.hash, "block", receipt.blockNumber);

  const requestIds = await hub.getRequestsForUser(signer.address);
  const latestRequestId = requestIds[requestIds.length - 1];
  console.log("Latest request id:", latestRequestId.toString());

  tx = await hub.fulfillClaimRequest(latestRequestId);
  receipt = await tx.wait();
  console.log("fulfillClaimRequest tx:", receipt.hash, "block", receipt.blockNumber);

  const requestAfter = await hub.claimRequests(latestRequestId);
  console.log("Request fulfilled:", requestAfter.fulfilled);

  section("6. InteractionHub: attestation");
  tx = await hub.createAttestation(signer.address, `e2e attestation ${Date.now()}`);
  receipt = await tx.wait();
  console.log("createAttestation tx:", receipt.hash, "block", receipt.blockNumber);

  const attestations = await hub.getAttestations(signer.address);
  console.log("Total attestations for signer:", attestations.length);

  section("DONE — all live Sepolia transactions confirmed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
