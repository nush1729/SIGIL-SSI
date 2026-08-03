const { expect } = require("chai");
const { ethers } = require("hardhat");
const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const ZK_BUILD_DIR = path.join(__dirname, "..", "..", "zk", "build");
const WASM_PATH = path.join(ZK_BUILD_DIR, "AgeOver18_js", "AgeOver18.wasm");
const ZKEY_PATH = path.join(ZK_BUILD_DIR, "AgeOver18_final.zkey");
const MIN_STAKE = ethers.parseEther("1");
const NO_EXPIRY = 0;

async function generateProofCalldata(poseidon, birthYear, salt, currentYear) {
  const hash = poseidon([BigInt(birthYear), BigInt(salt)]);
  const commitment = poseidon.F.toString(hash);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { birthYear, salt, commitment, currentYear },
    WASM_PATH,
    ZKEY_PATH
  );

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC, pubSignals] = JSON.parse(`[${calldata}]`);
  return { pA, pB, pC, pubSignals, commitment };
}

describe("AgeVerification (Tier 1 #2: ZK age-over-18 predicate proof, credential-bound)", function () {
  let ssi, trustRegistry, verifier, ageVerification, deployer, issuer, user, stranger, poseidon;

  before(async function () {
    this.timeout(60000);
    poseidon = await buildPoseidon();
  });

  beforeEach(async function () {
    [deployer, issuer, user, stranger] = await ethers.getSigners();

    const TrustRegistry = await ethers.getContractFactory("NeuralHashTrustRegistry");
    trustRegistry = await TrustRegistry.deploy(MIN_STAKE);
    await trustRegistry.waitForDeployment();
    await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
    await trustRegistry.setIssuer(issuer.address, "Acme ID Authority", "", true);

    const NeuralHashSSI = await ethers.getContractFactory("NeuralHashSSI");
    ssi = await NeuralHashSSI.deploy(await trustRegistry.getAddress());
    await ssi.waitForDeployment();

    const Verifier = await ethers.getContractFactory("AgeOver18Groth16Verifier");
    verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    const AgeVerification = await ethers.getContractFactory("AgeVerification");
    ageVerification = await AgeVerification.deploy(
      await verifier.getAddress(),
      await ssi.getAddress()
    );
    await ageVerification.waitForDeployment();
  });

  it("reverts on a zero verifier or zero registry address at construction", async function () {
    const AgeVerification = await ethers.getContractFactory("AgeVerification");
    await expect(
      AgeVerification.deploy(ethers.ZeroAddress, await ssi.getAddress())
    ).to.be.revertedWith("Zero verifier");
    await expect(
      AgeVerification.deploy(await verifier.getAddress(), ethers.ZeroAddress)
    ).to.be.revertedWith("Zero registry");
  });

  describe("NeuralHashSSI.setAgeCommitment", function () {
    it("only the credential's original issuer can set its age commitment", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-1"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      await expect(
        ssi.connect(stranger).setAgeCommitment(user.address, hash, 12345)
      ).to.be.revertedWith("Only issuer");

      await expect(ssi.connect(issuer).setAgeCommitment(user.address, hash, 12345))
        .to.emit(ssi, "AgeCommitmentSet")
        .withArgs(user.address, hash, 12345);

      expect(await ssi.getAgeCommitment(hash)).to.equal(12345);
    });

    it("cannot be set twice, and cannot be zero", async function () {
      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-2"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      await ssi.connect(issuer).setAgeCommitment(user.address, hash, 999);
      await expect(
        ssi.connect(issuer).setAgeCommitment(user.address, hash, 111)
      ).to.be.revertedWith("Already set");

      const hash2 = ethers.keccak256(ethers.toUtf8Bytes("id-credential-3"));
      await ssi.connect(issuer).issueCredential(user.address, hash2, "cid2", NO_EXPIRY);
      await expect(
        ssi.connect(issuer).setAgeCommitment(user.address, hash2, 0)
      ).to.be.revertedWith("Zero commitment");
    });

    it("reverts for a credential that doesn't exist", async function () {
      const fakeHash = ethers.keccak256(ethers.toUtf8Bytes("never-issued"));
      await expect(
        ssi.connect(issuer).setAgeCommitment(user.address, fakeHash, 123)
      ).to.be.revertedWith("Not found");
    });
  });

  describe("submitAgeProof — the credential-binding fix", function () {
    it("REJECTS a self-attested proof with no backing credential (the original gap)", async function () {
      this.timeout(60000);

      // No credential issued, no commitment anchored anywhere — user just
      // generates a proof for a birth year they typed in themselves.
      const { pA, pB, pC, pubSignals } = await generateProofCalldata(
        poseidon,
        2000,
        "111111",
        2026
      );

      const fakeCredentialHash = ethers.keccak256(ethers.toUtf8Bytes("unbacked"));
      await expect(
        ageVerification.connect(user).submitAgeProof(fakeCredentialHash, pA, pB, pC, pubSignals)
      ).to.be.revertedWith("Credential not valid");
    });

    it("REJECTS a proof for a real credential that has no age commitment set", async function () {
      this.timeout(60000);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-no-commitment"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);
      // Note: setAgeCommitment deliberately not called.

      const { pA, pB, pC, pubSignals } = await generateProofCalldata(
        poseidon,
        2000,
        "222222",
        2026
      );

      await expect(
        ageVerification.connect(user).submitAgeProof(hash, pA, pB, pC, pubSignals)
      ).to.be.revertedWith("No age commitment on this credential");
    });

    it("REJECTS a proof whose commitment doesn't match what the issuer anchored (swapped-identity attack)", async function () {
      this.timeout(60000);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-real-dob"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      // Issuer anchors a commitment for the REAL, document-verified birth year.
      const real = await generateProofCalldata(poseidon, 2000, "333333", 2026);
      await ssi.connect(issuer).setAgeCommitment(user.address, hash, real.commitment);

      // User tries to reuse the credential slot with a proof for a DIFFERENT,
      // self-chosen birth year (e.g. to appear older/younger than the
      // document actually says). Same credential, different commitment.
      const fabricated = await generateProofCalldata(poseidon, 1990, "444444", 2026);

      await expect(
        ageVerification
          .connect(user)
          .submitAgeProof(hash, fabricated.pA, fabricated.pB, fabricated.pC, fabricated.pubSignals)
      ).to.be.revertedWith("Commitment does not match credential");
    });

    it("ACCEPTS a proof correctly bound to a real, issuer-attested credential", async function () {
      this.timeout(60000);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-valid-bound"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      const { pA, pB, pC, pubSignals, commitment } = await generateProofCalldata(
        poseidon,
        2000,
        "555555",
        2026
      );
      await ssi.connect(issuer).setAgeCommitment(user.address, hash, commitment);

      await expect(
        ageVerification.connect(user).submitAgeProof(hash, pA, pB, pC, pubSignals)
      )
        .to.emit(ageVerification, "AgeVerified")
        .withArgs(user.address, hash, BigInt(pubSignals[0]), BigInt(pubSignals[1]));

      expect(await ageVerification.isAgeVerified(user.address)).to.equal(true);
      expect(await ageVerification.credentialUsed(user.address)).to.equal(hash);
    });

    it("REJECTS a proof against a credential that has since been revoked", async function () {
      this.timeout(60000);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-revoked"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      const { pA, pB, pC, pubSignals, commitment } = await generateProofCalldata(
        poseidon,
        2000,
        "666666",
        2026
      );
      await ssi.connect(issuer).setAgeCommitment(user.address, hash, commitment);
      await ssi.connect(issuer).revokeCredential(user.address, hash);

      await expect(
        ageVerification.connect(user).submitAgeProof(hash, pA, pB, pC, pubSignals)
      ).to.be.revertedWith("Credential not valid");
    });

    it("someone else cannot use a proof bound to a credential they don't hold", async function () {
      this.timeout(60000);

      const hash = ethers.keccak256(ethers.toUtf8Bytes("id-credential-owned-by-user"));
      await ssi.connect(issuer).issueCredential(user.address, hash, "cid1", NO_EXPIRY);

      const { pA, pB, pC, pubSignals, commitment } = await generateProofCalldata(
        poseidon,
        2000,
        "777777",
        2026
      );
      await ssi.connect(issuer).setAgeCommitment(user.address, hash, commitment);

      // `stranger` submits proof for a credential that verifyCredential(stranger, hash) is false for.
      await expect(
        ageVerification.connect(stranger).submitAgeProof(hash, pA, pB, pC, pubSignals)
      ).to.be.revertedWith("Credential not valid");
    });

    it("cannot even generate a witness for an underage claim — rejected before a proof can exist", async function () {
      this.timeout(60000);

      const hash = poseidon([BigInt(2015), BigInt("888888")]);
      const commitment = poseidon.F.toString(hash);

      let threw = false;
      try {
        await snarkjs.groth16.fullProve(
          { birthYear: 2015, salt: "888888", commitment, currentYear: 2026 },
          WASM_PATH,
          ZKEY_PATH
        );
      } catch (err) {
        threw = true;
      }
      expect(threw).to.equal(true);
    });
  });
});
