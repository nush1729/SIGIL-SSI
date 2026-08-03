// Live end-to-end test of the guardian-recovery smart wallet (Identity.sol)
// against the deployed Sepolia stack. Generates throwaway test wallets for
// owner/guardians (funded from the deployer's balance), deploys a fresh
// Identity contract, links a real credential, then runs TWO full recovery
// rounds to prove guardians can vote again after a completed recovery
// (regression test for the vote-reset bug fixed in Identity.sol).
//
// No private keys are ever printed — only addresses and tx hashes.
require("dotenv").config();
const { ethers } = require("hardhat");

const SSI_ADDRESS =
  process.env.SSI_REGISTRY_ADDRESS || "0xa9025B3065785aEdb2Ac08017cF1a6F943deAfd3";

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function fund(deployer, wallet, amountEth, label) {
  const tx = await deployer.sendTransaction({
    to: wallet.address,
    value: ethers.parseEther(amountEth),
  });
  await tx.wait();
  console.log(`Funded ${label} (${wallet.address}) with ${amountEth} ETH — tx ${tx.hash}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider;

  console.log("Deployer (pays gas for funding + Identity deployment):", deployer.address);

  const owner = ethers.Wallet.createRandom().connect(provider);
  const guardian1 = ethers.Wallet.createRandom().connect(provider);
  const guardian2 = ethers.Wallet.createRandom().connect(provider);
  const recoveredOwnerTarget = ethers.Wallet.createRandom(); // just an address, never signs

  section("Generated throwaway test wallets");
  console.log("owner:               ", owner.address);
  console.log("guardian1:           ", guardian1.address);
  console.log("guardian2:           ", guardian2.address);
  console.log("recovery target addr:", recoveredOwnerTarget.address);

  section("Funding test wallets from deployer");
  await fund(deployer, owner, "0.002", "owner");
  await fund(deployer, guardian1, "0.006", "guardian1");
  await fund(deployer, guardian2, "0.004", "guardian2");

  const ssiAbi = (await ethers.getContractFactory("NeuralHashSSI")).interface;
  const ssi = new ethers.Contract(SSI_ADDRESS, ssiAbi, deployer);

  section("Deploy Identity (guardian-recovery wallet)");
  // recoveryTimelock=0 here so this smoke test finalizes recovery
  // immediately after threshold is reached, instead of waiting out a real
  // delay on a live network. Real per-user deployments (deployIdentity.js)
  // default to a 1 hour timelock — see Identity.sol.
  const Identity = await ethers.getContractFactory("Identity", deployer);
  const identity = await Identity.deploy(
    owner.address,
    [guardian1.address, guardian2.address],
    2,
    SSI_ADDRESS,
    0
  );
  await identity.waitForDeployment();
  const identityAddress = await identity.getAddress();
  console.log("Identity deployed to:", identityAddress);
  console.log("guardianCount:", (await identity.guardianCount()).toString());
  console.log("recoveryThreshold:", (await identity.recoveryThreshold()).toString());

  section("Issue a real credential to the Identity contract's own address");
  // Credentials must be issued to the Identity contract's address (not the
  // raw owner EOA) for linkCredential to accept them, and for the credential
  // to remain reachable across a future guardian recovery — see Identity.sol.
  const credential = { type: "GuardianTest", identityAddress, nonce: Date.now() };
  const credentialHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(credential)));
  let tx = await ssi.issueCredential(identityAddress, credentialHash, "e2e-guardian-test-cid", 0);
  await tx.wait();
  console.log("Issued credential", credentialHash, "to Identity contract", identityAddress);

  section("Owner links the real credential to the guardian wallet");
  const identityAsOwner = identity.connect(owner);
  tx = await identityAsOwner.linkCredential(credentialHash);
  await tx.wait();
  const linked = await identity.getLinkedCredentials();
  console.log("linkCredential tx confirmed. Linked credentials:", linked);

  section("ROUND 1: recover ownership from `owner` to `recoveredOwnerTarget`");
  const identityAsGuardian1 = identity.connect(guardian1);
  const identityAsGuardian2 = identity.connect(guardian2);

  tx = await identityAsGuardian1.proposeRecovery(recoveredOwnerTarget.address);
  await tx.wait();
  console.log("guardian1 proposed recovery ->", recoveredOwnerTarget.address);

  tx = await identityAsGuardian1.voteRecovery();
  await tx.wait();
  let voteCount = await identity.voteCount();
  let owner1 = await identity.owner();
  console.log(`guardian1 voted. voteCount=${voteCount} owner (should be unchanged)=${owner1}`);

  tx = await identityAsGuardian2.voteRecovery();
  await tx.wait();
  console.log("guardian2 voted (2nd vote, threshold=2) — recovery threshold reached, timelock (0s) now elapsed");

  tx = await identity.connect(deployer).finalizeRecovery();
  await tx.wait();
  let ownerAfterRound1 = await identity.owner();
  console.log(`finalizeRecovery() called. owner is now: ${ownerAfterRound1}`);
  console.log(
    "Recovery round 1 result:",
    ownerAfterRound1.toLowerCase() === recoveredOwnerTarget.address.toLowerCase()
      ? "SUCCESS — ownership transferred"
      : "FAILED — ownership did not transfer"
  );

  section("ROUND 2: recover back to `owner` — proves guardians can vote again (vote-reset fix)");
  tx = await identityAsGuardian1.proposeRecovery(owner.address);
  await tx.wait();
  console.log("guardian1 proposed recovery -> back to original owner", owner.address);

  tx = await identityAsGuardian1.voteRecovery();
  await tx.wait();
  console.log("guardian1 voted again (would revert with 'Already voted' if the vote-reset bug were present)");

  tx = await identityAsGuardian2.voteRecovery();
  await tx.wait();

  tx = await identity.connect(deployer).finalizeRecovery();
  await tx.wait();
  const ownerAfterRound2 = await identity.owner();
  console.log(`guardian2 voted again, finalizeRecovery() called. owner is now: ${ownerAfterRound2}`);
  console.log(
    "Recovery round 2 result:",
    ownerAfterRound2.toLowerCase() === owner.address.toLowerCase()
      ? "SUCCESS — ownership restored, vote-reset fix confirmed live"
      : "FAILED"
  );

  section("Guardian management: add a 3rd guardian, then update the threshold");
  const identityAsOwnerAgain = identity.connect(owner); // owner was restored in round 2
  const guardian3 = ethers.Wallet.createRandom();

  tx = await identityAsOwnerAgain.addGuardian(guardian3.address);
  await tx.wait();
  console.log("Added guardian3:", guardian3.address, "guardianCount now:", (await identity.guardianCount()).toString());

  tx = await identityAsOwnerAgain.setRecoveryThreshold(3);
  await tx.wait();
  console.log("Recovery threshold updated to:", (await identity.recoveryThreshold()).toString());

  // This should revert: removing guardian3 would drop the guardian count to
  // 2, below the threshold of 3 we just set. ethers simulates the call
  // before broadcasting, so the revert happens on the call itself.
  let removalBlockedCorrectly = false;
  try {
    tx = await identityAsOwnerAgain.removeGuardian(guardian3.address);
    await tx.wait();
  } catch {
    removalBlockedCorrectly = true;
  }
  console.log(
    "Attempted to remove guardian3 while threshold=3 (expected to be blocked by the chain):",
    removalBlockedCorrectly ? "correctly blocked" : "UNEXPECTEDLY SUCCEEDED"
  );

  section("DONE");
  console.log("Identity contract (view it on Sepolia Etherscan):", identityAddress);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
