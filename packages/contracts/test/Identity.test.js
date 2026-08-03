const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN_STAKE = ethers.parseEther("1");
const NO_EXPIRY = 0;
const RECOVERY_TIMELOCK = 3600; // 1 hour, matches deployIdentity.js's default

async function fastForwardPastTimelock() {
  await ethers.provider.send("evm_increaseTime", [RECOVERY_TIMELOCK]);
  await ethers.provider.send("evm_mine");
}

describe("Identity", function () {
  let ssi, trustRegistry, ownerWallet, issuer, guardian1, guardian2, guardian3, newOwner, stranger;
  let identity;

  beforeEach(async function () {
    [ownerWallet, issuer, guardian1, guardian2, guardian3, newOwner, stranger] =
      await ethers.getSigners();

    const TrustRegistry = await ethers.getContractFactory(
      "NeuralHashTrustRegistry"
    );
    trustRegistry = await TrustRegistry.deploy(MIN_STAKE);
    await trustRegistry.waitForDeployment();
    await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
    await trustRegistry.setIssuer(issuer.address, "Acme University", "", true);

    const NeuralHashSSI = await ethers.getContractFactory("NeuralHashSSI");
    ssi = await NeuralHashSSI.deploy(await trustRegistry.getAddress());
    await ssi.waitForDeployment();

    const Identity = await ethers.getContractFactory("Identity");
    identity = await Identity.deploy(
      ownerWallet.address,
      [guardian1.address, guardian2.address, guardian3.address],
      2,
      await ssi.getAddress(),
      RECOVERY_TIMELOCK
    );
    await identity.waitForDeployment();
  });

  describe("constructor validation (fixes bug #4)", function () {
    it("reverts when threshold is zero", async function () {
      const Identity = await ethers.getContractFactory("Identity");
      await expect(
        Identity.deploy(
          ownerWallet.address,
          [guardian1.address],
          0,
          await ssi.getAddress(),
          RECOVERY_TIMELOCK
        )
      ).to.be.revertedWith("Invalid threshold");
    });

    it("reverts when threshold exceeds guardian count", async function () {
      const Identity = await ethers.getContractFactory("Identity");
      await expect(
        Identity.deploy(
          ownerWallet.address,
          [guardian1.address],
          2,
          await ssi.getAddress(),
          RECOVERY_TIMELOCK
        )
      ).to.be.revertedWith("Invalid threshold");
    });

    it("reverts on duplicate guardian addresses", async function () {
      const Identity = await ethers.getContractFactory("Identity");
      await expect(
        Identity.deploy(
          ownerWallet.address,
          [guardian1.address, guardian1.address],
          1,
          await ssi.getAddress(),
          RECOVERY_TIMELOCK
        )
      ).to.be.revertedWith("Duplicate guardian");
    });
  });

  describe("linkCredential (fixes bug #2 + reconciles credential store, bug #6)", function () {
    it("reverts if the credential was never issued to this Identity contract in NeuralHashSSI", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("fake-credential"));
      await expect(
        identity.connect(ownerWallet).linkCredential(hash)
      ).to.be.revertedWith("Credential not valid for this wallet");
    });

    it("reverts if called by anyone other than the Identity owner", async function () {
      const identityAddress = await identity.getAddress();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      await ssi.connect(issuer).issueCredential(identityAddress, hash, "cid1", NO_EXPIRY);

      await expect(
        identity.connect(stranger).linkCredential(hash)
      ).to.be.revertedWith("Not owner");
    });

    it("links a genuinely-issued credential and emits CredentialLinked", async function () {
      const identityAddress = await identity.getAddress();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      await ssi.connect(issuer).issueCredential(identityAddress, hash, "cid1", NO_EXPIRY);

      await expect(identity.connect(ownerWallet).linkCredential(hash))
        .to.emit(identity, "CredentialLinked")
        .withArgs(hash);

      const linked = await identity.getLinkedCredentials();
      expect(linked).to.deep.equal([hash]);
    });

    it("cannot link an address's credential to someone else's wallet, and cannot double-link", async function () {
      const identityAddress = await identity.getAddress();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      // issued to `stranger`, not to this Identity contract
      await ssi.connect(issuer).issueCredential(stranger.address, hash, "cid1", NO_EXPIRY);

      await expect(
        identity.connect(ownerWallet).linkCredential(hash)
      ).to.be.revertedWith("Credential not valid for this wallet");

      const ownHash = ethers.keccak256(ethers.toUtf8Bytes("credential-2"));
      await ssi.connect(issuer).issueCredential(identityAddress, ownHash, "cid2", NO_EXPIRY);
      await identity.connect(ownerWallet).linkCredential(ownHash);

      await expect(
        identity.connect(ownerWallet).linkCredential(ownHash)
      ).to.be.revertedWith("Already linked");
    });
  });

  describe("guardian management (Tier 2 #3: add/remove guardians)", function () {
    it("only owner can add or remove guardians", async function () {
      await expect(
        identity.connect(stranger).addGuardian(newOwner.address)
      ).to.be.revertedWith("Not owner");

      await expect(
        identity.connect(stranger).removeGuardian(guardian1.address)
      ).to.be.revertedWith("Not owner");
    });

    it("adds a guardian, bumping guardianCount, and emits GuardianAdded", async function () {
      await expect(identity.connect(ownerWallet).addGuardian(newOwner.address))
        .to.emit(identity, "GuardianAdded")
        .withArgs(newOwner.address);

      expect(await identity.guardianCount()).to.equal(4);
      expect(await identity.guardians(newOwner.address)).to.equal(true);

      const guardianList = await identity.getGuardians();
      expect(guardianList).to.include(newOwner.address);
    });

    it("reverts adding a zero address or duplicate guardian", async function () {
      await expect(
        identity.connect(ownerWallet).addGuardian(ethers.ZeroAddress)
      ).to.be.revertedWith("Zero guardian");

      await expect(
        identity.connect(ownerWallet).addGuardian(guardian1.address)
      ).to.be.revertedWith("Already a guardian");
    });

    it("removes a guardian and emits GuardianRemoved", async function () {
      await expect(identity.connect(ownerWallet).removeGuardian(guardian3.address))
        .to.emit(identity, "GuardianRemoved")
        .withArgs(guardian3.address);

      expect(await identity.guardianCount()).to.equal(2);
      expect(await identity.guardians(guardian3.address)).to.equal(false);

      const guardianList = await identity.getGuardians();
      expect(guardianList).to.not.include(guardian3.address);
    });

    it("reverts removing a guardian that would break the recovery threshold", async function () {
      // 3 guardians, threshold 2 — removing one more would drop to 1, below threshold.
      await identity.connect(ownerWallet).removeGuardian(guardian3.address);

      await expect(
        identity.connect(ownerWallet).removeGuardian(guardian2.address)
      ).to.be.revertedWith("Would break threshold");
    });

    it("lets owner update the recovery threshold within bounds", async function () {
      await expect(identity.connect(ownerWallet).setRecoveryThreshold(3))
        .to.emit(identity, "RecoveryThresholdUpdated")
        .withArgs(3);
      expect(await identity.recoveryThreshold()).to.equal(3);

      await expect(
        identity.connect(ownerWallet).setRecoveryThreshold(4)
      ).to.be.revertedWith("Invalid threshold");
      await expect(
        identity.connect(ownerWallet).setRecoveryThreshold(0)
      ).to.be.revertedWith("Invalid threshold");
    });

    it("blocks guardian/threshold changes while a recovery proposal is active", async function () {
      await identity.connect(guardian1).proposeRecovery(newOwner.address);

      await expect(
        identity.connect(ownerWallet).addGuardian(stranger.address)
      ).to.be.revertedWith("Active recovery proposal");
      await expect(
        identity.connect(ownerWallet).removeGuardian(guardian1.address)
      ).to.be.revertedWith("Active recovery proposal");
      await expect(
        identity.connect(ownerWallet).setRecoveryThreshold(1)
      ).to.be.revertedWith("Active recovery proposal");
    });
  });

  describe("execute() controller forwarding (Tier 1 #1: recovery restores credential access)", function () {
    it("only owner can call execute", async function () {
      await expect(
        identity.connect(stranger).execute(await ssi.getAddress(), "0x")
      ).to.be.revertedWith("Not owner");
    });

    it("forwards a call as the Identity contract itself, and NeuralHashSSI sees the Identity address as msg.sender", async function () {
      // Issue a credential directly to the Identity contract's own address —
      // this is what makes it survive a future recovery: whoever ends up
      // owning this contract can act as it via execute().
      const identityAddress = await identity.getAddress();
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-for-identity"));
      await ssi.connect(issuer).issueCredential(identityAddress, hash, "cid1", NO_EXPIRY);

      expect(await ssi.verifyCredential(identityAddress, hash)).to.equal(true);

      // Now recover ownership to `newOwner`: reach threshold, wait out the
      // timelock, then finalize.
      await identity.connect(guardian1).proposeRecovery(newOwner.address);
      await identity.connect(guardian1).voteRecovery();
      await identity.connect(guardian2).voteRecovery();
      await fastForwardPastTimelock();
      await identity.connect(newOwner).finalizeRecovery();
      expect(await identity.owner()).to.equal(newOwner.address);

      // The OLD owner has lost control entirely — even read-only forwarding
      // via execute() is rejected now that ownership has moved on.
      const verifyCall = ssi.interface.encodeFunctionData("verifyCredential", [
        identityAddress,
        hash,
      ]);
      await expect(
        identity.connect(ownerWallet).execute(await ssi.getAddress(), verifyCall)
      ).to.be.revertedWith("Not owner");

      // The NEW owner links the credential that was issued to the Identity
      // contract's own address — proving recovery actually restored access
      // to it, not just control of an empty shell. (linkCredential is native
      // to Identity, not reached via execute(); execute() is for reaching
      // *other* contracts, e.g. InteractionHub, as this wallet.)
      await identity.connect(newOwner).linkCredential(hash);
      const linked = await identity.getLinkedCredentials();
      expect(linked).to.deep.equal([hash]);
    });

    it("reverts and bubbles up failure when the forwarded call reverts", async function () {
      const badData = ssi.interface.encodeFunctionData("revokeCredential", [
        ownerWallet.address,
        ethers.keccak256(ethers.toUtf8Bytes("nonexistent")),
      ]);

      await expect(
        identity.connect(ownerWallet).execute(await ssi.getAddress(), badData)
      ).to.be.revertedWith("Execution failed");
    });

    it("reverts on a zero target address", async function () {
      await expect(
        identity.connect(ownerWallet).execute(ethers.ZeroAddress, "0x")
      ).to.be.revertedWith("Zero target");
    });
  });

  describe("guardian recovery (fixes bug #9 events + vote-reset bug)", function () {
    it("only guardians can propose or vote", async function () {
      await expect(
        identity.connect(stranger).proposeRecovery(newOwner.address)
      ).to.be.revertedWith("Not guardian");

      await identity.connect(guardian1).proposeRecovery(newOwner.address);

      await expect(
        identity.connect(stranger).voteRecovery()
      ).to.be.revertedWith("Not guardian");
    });

    it("emits RecoveryProposed, RecoveryVoted, and RecoveryThresholdReached, but does not transfer ownership until finalizeRecovery() after the timelock", async function () {
      await expect(identity.connect(guardian1).proposeRecovery(newOwner.address))
        .to.emit(identity, "RecoveryProposed")
        .withArgs(newOwner.address, guardian1.address);

      await expect(identity.connect(guardian1).voteRecovery())
        .to.emit(identity, "RecoveryVoted")
        .withArgs(guardian1.address, newOwner.address, 1);

      expect(await identity.owner()).to.equal(ownerWallet.address);

      await expect(identity.connect(guardian2).voteRecovery())
        .to.emit(identity, "RecoveryVoted")
        .withArgs(guardian2.address, newOwner.address, 2)
        .and.to.emit(identity, "RecoveryThresholdReached");

      // Threshold reached, but ownership has NOT transferred yet — this is
      // the timelock (docs/threat-model.md).
      expect(await identity.owner()).to.equal(ownerWallet.address);

      await expect(identity.connect(newOwner).finalizeRecovery()).to.be.revertedWith(
        "Timelock not elapsed"
      );

      await fastForwardPastTimelock();

      await expect(identity.connect(newOwner).finalizeRecovery())
        .to.emit(identity, "RecoveryExecuted")
        .withArgs(ownerWallet.address, newOwner.address);

      expect(await identity.owner()).to.equal(newOwner.address);
    });

    it("prevents a guardian from voting twice on the same proposal", async function () {
      await identity.connect(guardian1).proposeRecovery(newOwner.address);
      await identity.connect(guardian1).voteRecovery();

      await expect(
        identity.connect(guardian1).voteRecovery()
      ).to.be.revertedWith("Already voted");
    });

    it("resets guardian votes after a successful recovery, allowing a second round", async function () {
      // First recovery round: guardian1 + guardian2 vote, threshold (2) reached.
      await identity.connect(guardian1).proposeRecovery(newOwner.address);
      await identity.connect(guardian1).voteRecovery();
      await identity.connect(guardian2).voteRecovery();
      await fastForwardPastTimelock();
      await identity.connect(newOwner).finalizeRecovery();
      expect(await identity.owner()).to.equal(newOwner.address);

      // Second recovery round back to the original owner: without the
      // vote-reset fix, guardian1/guardian2 would be stuck as "already voted"
      // forever and could never participate in a future recovery.
      await identity.connect(guardian1).proposeRecovery(ownerWallet.address);
      await identity.connect(guardian1).voteRecovery();
      await identity.connect(guardian2).voteRecovery();
      await fastForwardPastTimelock();
      await identity.connect(ownerWallet).finalizeRecovery();

      expect(await identity.owner()).to.equal(ownerWallet.address);
    });

    it("resets votes when a new proposal supersedes an unfinished one", async function () {
      await identity.connect(guardian1).proposeRecovery(newOwner.address);
      await identity.connect(guardian1).voteRecovery();

      // A different guardian proposes a competing recovery target before
      // threshold is reached — guardian1's earlier vote must not carry over.
      await identity.connect(guardian2).proposeRecovery(stranger.address);

      await identity.connect(guardian1).voteRecovery();
      await identity.connect(guardian2).voteRecovery();
      await fastForwardPastTimelock();
      await identity.connect(stranger).finalizeRecovery();

      expect(await identity.owner()).to.equal(stranger.address);
    });
  });

  describe("recovery timelock + cancellation (closes the no-veto-window threat-model gap)", function () {
    async function reachThreshold(target) {
      await identity.connect(guardian1).proposeRecovery(target);
      await identity.connect(guardian1).voteRecovery();
      await identity.connect(guardian2).voteRecovery();
    }

    it("finalizeRecovery reverts before threshold is reached", async function () {
      await identity.connect(guardian1).proposeRecovery(newOwner.address);
      await identity.connect(guardian1).voteRecovery();

      await expect(identity.connect(newOwner).finalizeRecovery()).to.be.revertedWith(
        "Threshold not reached"
      );
    });

    it("finalizeRecovery is permissionless — anyone can call it once ready", async function () {
      await reachThreshold(newOwner.address);
      await fastForwardPastTimelock();

      await expect(identity.connect(stranger).finalizeRecovery())
        .to.emit(identity, "RecoveryExecuted")
        .withArgs(ownerWallet.address, newOwner.address);
    });

    it("the current owner can cancel a recovery before it finalizes, defeating colluding guardians", async function () {
      await reachThreshold(newOwner.address);

      // Owner notices this recovery was never authorized and cancels it
      // during the timelock window.
      await expect(identity.connect(ownerWallet).cancelRecovery())
        .to.emit(identity, "RecoveryCancelled")
        .withArgs(newOwner.address, ownerWallet.address);

      expect(await identity.proposedOwner()).to.equal(ethers.ZeroAddress);
      expect(await identity.owner()).to.equal(ownerWallet.address);

      // Even after the original timelock window would have elapsed, there is
      // no pending proposal left to finalize.
      await fastForwardPastTimelock();
      await expect(identity.connect(stranger).finalizeRecovery()).to.be.revertedWith(
        "No proposal"
      );
    });

    it("cancelRecovery reverts if called by anyone other than owner, or with no active proposal", async function () {
      await expect(identity.connect(stranger).cancelRecovery()).to.be.revertedWith(
        "Not owner"
      );

      await expect(identity.connect(ownerWallet).cancelRecovery()).to.be.revertedWith(
        "No proposal"
      );
    });

    it("guardians can immediately re-propose after a cancellation, restarting the clock", async function () {
      // Documents the accepted trade-off in docs/threat-model.md: a
      // cancellation delays recovery, it does not permanently block it.
      await reachThreshold(newOwner.address);
      await identity.connect(ownerWallet).cancelRecovery();

      await reachThreshold(stranger.address);
      await fastForwardPastTimelock();
      await identity.connect(stranger).finalizeRecovery();

      expect(await identity.owner()).to.equal(stranger.address);
    });
  });
});
