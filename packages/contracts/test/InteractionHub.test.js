const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN_STAKE = ethers.parseEther("1");

describe("InteractionHub", function () {
  let hub, trustRegistry, trustedRequester, untrusted, subject;

  beforeEach(async function () {
    [trustedRequester, untrusted, subject] = await ethers.getSigners();

    const TrustRegistry = await ethers.getContractFactory(
      "NeuralHashTrustRegistry"
    );
    trustRegistry = await TrustRegistry.deploy(MIN_STAKE);
    await trustRegistry.waitForDeployment();
    await trustRegistry.connect(trustedRequester).depositStake({ value: MIN_STAKE });
    await trustRegistry.setIssuer(
      trustedRequester.address,
      "Employer Inc",
      "",
      true
    );

    const InteractionHub = await ethers.getContractFactory("InteractionHub");
    hub = await InteractionHub.deploy(await trustRegistry.getAddress());
    await hub.waitForDeployment();
  });

  describe("createClaimRequest", function () {
    it("reverts when requester is not trusted", async function () {
      await expect(
        hub
          .connect(untrusted)
          .createClaimRequest(subject.address, ["type"], "verify degree")
      ).to.be.revertedWith("Requester not trusted");
    });

    it("stores the request and emits ClaimRequested for a trusted requester", async function () {
      await expect(
        hub
          .connect(trustedRequester)
          .createClaimRequest(subject.address, ["type", "year"], "verify degree")
      )
        .to.emit(hub, "ClaimRequested")
        .withArgs(1, trustedRequester.address, subject.address);

      const ids = await hub.getRequestsForUser(subject.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);

      const request = await hub.claimRequests(1);
      expect(request.requester).to.equal(trustedRequester.address);
      expect(request.subject).to.equal(subject.address);
      expect(request.purpose).to.equal("verify degree");
      expect(request.fulfilled).to.equal(false);
    });
  });

  describe("fulfillClaimRequest", function () {
    it("only the subject can fulfill their own request", async function () {
      await hub
        .connect(trustedRequester)
        .createClaimRequest(subject.address, ["type"], "verify degree");

      await expect(
        hub.connect(untrusted).fulfillClaimRequest(1)
      ).to.be.revertedWith("Not subject");

      await expect(hub.connect(subject).fulfillClaimRequest(1))
        .to.emit(hub, "ClaimFulfilled")
        .withArgs(1, subject.address);

      await expect(
        hub.connect(subject).fulfillClaimRequest(1)
      ).to.be.revertedWith("Already fulfilled");
    });
  });

  describe("createAttestation", function () {
    it("reverts when attester is not trusted", async function () {
      await expect(
        hub.connect(untrusted).createAttestation(subject.address, "great hire")
      ).to.be.revertedWith("Attester not trusted");
    });

    it("stores the attestation and emits AttestationCreated", async function () {
      await expect(
        hub
          .connect(trustedRequester)
          .createAttestation(subject.address, "great hire")
      )
        .to.emit(hub, "AttestationCreated")
        .withArgs(trustedRequester.address, subject.address, "great hire");

      const attestations = await hub.getAttestations(subject.address);
      expect(attestations.length).to.equal(1);
      expect(attestations[0].attester).to.equal(trustedRequester.address);
      expect(attestations[0].statement).to.equal("great hire");
    });
  });
});
