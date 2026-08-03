const { expect } = require("chai");
const { ethers } = require("hardhat");

const MIN_STAKE = ethers.parseEther("1");

describe("NeuralHashTrustRegistry", function () {
  let trustRegistry, owner, issuer, other;

  beforeEach(async function () {
    [owner, issuer, other] = await ethers.getSigners();
    const TrustRegistry = await ethers.getContractFactory(
      "NeuralHashTrustRegistry"
    );
    trustRegistry = await TrustRegistry.deploy(MIN_STAKE);
    await trustRegistry.waitForDeployment();
  });

  it("sets deployer as owner and configured minimum stake", async function () {
    expect(await trustRegistry.owner()).to.equal(owner.address);
    expect(await trustRegistry.minimumStake()).to.equal(MIN_STAKE);
  });

  describe("staking gates trust (novelty: economic accountability)", function () {
    it("reverts setIssuer(true) if the issuer has not staked enough", async function () {
      await expect(
        trustRegistry.setIssuer(issuer.address, "Acme University", "ipfs://meta", true)
      ).to.be.revertedWith("Issuer has not staked enough");
    });

    it("lets owner mark an issuer trusted once they've staked enough", async function () {
      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      await trustRegistry.setIssuer(issuer.address, "Acme University", "ipfs://meta", true);

      expect(await trustRegistry.isTrusted(issuer.address)).to.equal(true);
      const details = await trustRegistry.getIssuer(issuer.address);
      expect(details.name).to.equal("Acme University");
      expect(details.trusted).to.equal(true);
    });

    it("accumulates stake across multiple deposits and emits StakeDeposited", async function () {
      await expect(
        trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE })
      )
        .to.emit(trustRegistry, "StakeDeposited")
        .withArgs(issuer.address, MIN_STAKE, MIN_STAKE);

      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      expect(await trustRegistry.stakedAmount(issuer.address)).to.equal(MIN_STAKE * 2n);
    });

    it("does not let a trusted issuer withdraw stake out from under active credentials", async function () {
      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      await trustRegistry.setIssuer(issuer.address, "Acme", "", true);

      await expect(
        trustRegistry.connect(issuer).withdrawStake(MIN_STAKE)
      ).to.be.revertedWith("Revoke trust before withdrawing stake");
    });

    it("lets an issuer withdraw stake once no longer trusted", async function () {
      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      await trustRegistry.setIssuer(issuer.address, "Acme", "", true);
      await trustRegistry.setIssuer(issuer.address, "Acme", "", false);

      await expect(
        trustRegistry.connect(issuer).withdrawStake(MIN_STAKE)
      )
        .to.emit(trustRegistry, "StakeWithdrawn")
        .withArgs(issuer.address, MIN_STAKE, 0);
    });
  });

  describe("slashing", function () {
    it("only owner can slash", async function () {
      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      await trustRegistry.setIssuer(issuer.address, "Acme", "", true);

      await expect(
        trustRegistry.connect(other).slash(issuer.address, MIN_STAKE)
      ).to.be.revertedWith("Not owner");
    });

    it("slashes stake, revokes trust, and forwards funds to the owner", async function () {
      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      await trustRegistry.setIssuer(issuer.address, "Acme", "", true);

      const ownerBalanceBefore = await ethers.provider.getBalance(owner.address);

      const tx = await trustRegistry.slash(issuer.address, MIN_STAKE);
      const receipt = await tx.wait();
      const gasCost = receipt.gasUsed * receipt.gasPrice;

      expect(await trustRegistry.isTrusted(issuer.address)).to.equal(false);
      expect(await trustRegistry.stakedAmount(issuer.address)).to.equal(0);

      const ownerBalanceAfter = await ethers.provider.getBalance(owner.address);
      expect(ownerBalanceAfter).to.equal(ownerBalanceBefore + MIN_STAKE - gasCost);
    });

    it("reverts slashing more than the issuer has staked", async function () {
      await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
      await expect(
        trustRegistry.slash(issuer.address, MIN_STAKE * 2n)
      ).to.be.revertedWith("Amount exceeds stake");
    });
  });

  it("owner can update the minimum stake requirement", async function () {
    const newMin = ethers.parseEther("2");
    await expect(trustRegistry.setMinimumStake(newMin))
      .to.emit(trustRegistry, "MinimumStakeUpdated")
      .withArgs(newMin);
    expect(await trustRegistry.minimumStake()).to.equal(newMin);
  });

  it("reverts when a non-owner tries to set issuer trust", async function () {
    await trustRegistry.connect(issuer).depositStake({ value: MIN_STAKE });
    await expect(
      trustRegistry
        .connect(other)
        .setIssuer(issuer.address, "Acme", "ipfs://meta", true)
    ).to.be.revertedWith("Not owner");
  });

  it("transfers ownership, emits event, and reverts on zero address", async function () {
    await expect(trustRegistry.transferOwnership(other.address))
      .to.emit(trustRegistry, "OwnershipTransferred")
      .withArgs(owner.address, other.address);
    expect(await trustRegistry.owner()).to.equal(other.address);

    await expect(
      trustRegistry.connect(other).transferOwnership(ethers.ZeroAddress)
    ).to.be.revertedWith("Zero address");
  });
});
