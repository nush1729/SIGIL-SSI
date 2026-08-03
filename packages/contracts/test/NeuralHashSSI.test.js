const { expect } = require("chai");
const { ethers } = require("hardhat");

// Matches OpenZeppelin's MerkleProof._hashPair: keccak256 of the two
// 32-byte values in sorted order, so the same helper works regardless of
// leaf ordering (mirrors merkletreejs's `sortPairs: true` used by the frontend).
function hashPair(a, b) {
  const [x, y] = BigInt(a) < BigInt(b) ? [a, b] : [b, a];
  return ethers.keccak256(ethers.concat([x, y]));
}

const MIN_STAKE = ethers.parseEther("1");
const NO_EXPIRY = 0;

async function latestBlockTimestamp() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

describe("NeuralHashSSI", function () {
  let ssi, trustRegistry, owner, issuer, untrustedIssuer, user;

  beforeEach(async function () {
    [owner, issuer, untrustedIssuer, user] = await ethers.getSigners();

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
  });

  it("reverts constructor on zero trust registry address", async function () {
    const NeuralHashSSI = await ethers.getContractFactory("NeuralHashSSI");
    await expect(NeuralHashSSI.deploy(ethers.ZeroAddress)).to.be.revertedWith(
      "Zero address"
    );
  });

  describe("issueCredential (issuer gating — fixes bug #1)", function () {
    it("reverts when caller is not a trusted issuer", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      await expect(
        ssi.connect(untrustedIssuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY)
      ).to.be.revertedWith("Issuer not trusted");
    });

    it("succeeds and emits CredentialIssued when caller is trusted", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      await expect(
        ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY)
      )
        .to.emit(ssi, "CredentialIssued")
        .withArgs(user.address, hash, "cid1", issuer.address, false, NO_EXPIRY);

      expect(await ssi.verifyCredential(user.address, hash)).to.equal(true);
    });

    it("reverts on duplicate credential hash", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);
      await expect(
        ssi.connect(issuer).issueCredential(user.address, hash, "cid2", NO_EXPIRY)
      ).to.be.revertedWith("Already issued");
    });
  });

  describe("credential expiry", function () {
    it("reverts issuance with an expiry already in the past", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("expired-at-issuance"));
      const past = (await latestBlockTimestamp()) - 10;
      await expect(
        ssi.connect(issuer).issueCredential(user.address, hash, "cid1", past)
      ).to.be.revertedWith("Invalid expiry");
    });

    it("verifyCredential returns true before expiry and false after", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("expiring-credential"));
      const expiresAt = (await latestBlockTimestamp()) + 3600;

      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", expiresAt);
      expect(await ssi.verifyCredential(user.address, hash)).to.equal(true);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      expect(await ssi.verifyCredential(user.address, hash)).to.equal(false);
    });

    it("verifyBatchInclusion returns false once the batch has expired", async function () {
      const leafA = ethers.keccak256(ethers.toUtf8Bytes("exp-leaf-a"));
      const leafB = ethers.keccak256(ethers.toUtf8Bytes("exp-leaf-b"));
      const root = hashPair(leafA, leafB);
      const expiresAt = (await latestBlockTimestamp()) + 3600;

      await ssi.connect(issuer).issueBatchCredential(user.address, root, "batch-cid", expiresAt);
      expect(
        await ssi.verifyBatchInclusion(user.address, root, leafA, [leafB])
      ).to.equal(true);

      await ethers.provider.send("evm_increaseTime", [3601]);
      await ethers.provider.send("evm_mine");

      expect(
        await ssi.verifyBatchInclusion(user.address, root, leafA, [leafB])
      ).to.equal(false);
    });

    it("expiresAt = 0 never expires", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("permanent-credential"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      await ethers.provider.send("evm_increaseTime", [10_000_000]);
      await ethers.provider.send("evm_mine");

      expect(await ssi.verifyCredential(user.address, hash)).to.equal(true);
    });
  });

  describe("revokeCredential", function () {
    it("only the original issuer can revoke", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("credential-1"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      await expect(
        ssi.connect(untrustedIssuer).revokeCredential(user.address, hash)
      ).to.be.revertedWith("Only issuer");

      await expect(ssi.connect(issuer).revokeCredential(user.address, hash))
        .to.emit(ssi, "CredentialRevoked")
        .withArgs(user.address, hash);

      expect(await ssi.verifyCredential(user.address, hash)).to.equal(false);
    });
  });

  describe("Merkle batch issuance + verification (fixes bug #3)", function () {
    it("verifies inclusion of a leaf in an anchored batch root", async function () {
      const leafA = ethers.keccak256(ethers.toUtf8Bytes("cred-a"));
      const leafB = ethers.keccak256(ethers.toUtf8Bytes("cred-b"));
      const root = hashPair(leafA, leafB);

      await ssi
        .connect(issuer)
        .issueBatchCredential(user.address, root, "batch-cid", NO_EXPIRY);

      expect(
        await ssi.verifyBatchInclusion(user.address, root, leafA, [leafB])
      ).to.equal(true);
      expect(
        await ssi.verifyBatchInclusion(user.address, root, leafB, [leafA])
      ).to.equal(true);
    });

    it("rejects a leaf that is not part of the anchored batch", async function () {
      const leafA = ethers.keccak256(ethers.toUtf8Bytes("cred-a"));
      const leafB = ethers.keccak256(ethers.toUtf8Bytes("cred-b"));
      const notInTree = ethers.keccak256(ethers.toUtf8Bytes("cred-z"));
      const root = hashPair(leafA, leafB);

      await ssi
        .connect(issuer)
        .issueBatchCredential(user.address, root, "batch-cid", NO_EXPIRY);

      expect(
        await ssi.verifyBatchInclusion(user.address, root, notInTree, [leafB])
      ).to.equal(false);
    });

    it("returns false once the batch has been revoked", async function () {
      const leafA = ethers.keccak256(ethers.toUtf8Bytes("cred-a"));
      const leafB = ethers.keccak256(ethers.toUtf8Bytes("cred-b"));
      const root = hashPair(leafA, leafB);

      await ssi
        .connect(issuer)
        .issueBatchCredential(user.address, root, "batch-cid", NO_EXPIRY);
      await ssi.connect(issuer).revokeCredential(user.address, root);

      expect(
        await ssi.verifyBatchInclusion(user.address, root, leafA, [leafB])
      ).to.equal(false);
    });

    it("does not treat a single-credential hash as a valid batch root", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("single-credential"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      expect(
        await ssi.verifyBatchInclusion(user.address, hash, hash, [])
      ).to.equal(false);
    });
  });
});
