// Redeploys the two contracts whose bytecode changed since the last live
// Sepolia deployment (the credential-binding fix touched NeuralHashSSI and
// AgeVerification). Reuses the existing TrustRegistry, InteractionHub,
// SchemaRegistry, and Groth16Verifier, since those contracts' bytecode is
// unchanged.
require("dotenv").config();
const hre = require("hardhat");

const TRUST_REGISTRY_ADDRESS = "0xaA9C23E2a650A44E364B3A13Aad662a2F6Bf5f93";
const GROTH16_VERIFIER_ADDRESS = "0xE07c1bBaef73d754223FD93BC4354a7B65e581fa";

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance before:", hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");

  section("Deploying NeuralHashSSI (credential-binding fix: ageCommitments/setAgeCommitment/getAgeCommitment)");
  const NeuralHashSSI = await hre.ethers.getContractFactory("NeuralHashSSI");
  const ssi = await NeuralHashSSI.deploy(TRUST_REGISTRY_ADDRESS);
  await ssi.waitForDeployment();
  const ssiAddress = await ssi.getAddress();
  console.log("NeuralHashSSI deployed to:", ssiAddress);

  section("Deploying AgeVerification (credential-binding fix: requires credentialHash, checks issuer-anchored commitment)");
  const AgeVerification = await hre.ethers.getContractFactory("AgeVerification");
  const ageVerification = await AgeVerification.deploy(GROTH16_VERIFIER_ADDRESS, ssiAddress);
  await ageVerification.waitForDeployment();
  const ageVerificationAddress = await ageVerification.getAddress();
  console.log("AgeVerification deployed to:", ageVerificationAddress);

  section("Staking + trusting the deployer as an issuer (fresh NeuralHashSSI has no state — TrustRegistry is reused, so no restaking needed there)");
  // NeuralHashSSI itself has no per-issuer state (trust lives in
  // TrustRegistry, which is reused) — nothing to redo here.

  section("Deployment summary");
  console.log(
    JSON.stringify(
      {
        trustRegistry: TRUST_REGISTRY_ADDRESS,
        neuralHashSSI: ssiAddress,
        groth16Verifier: GROTH16_VERIFIER_ADDRESS,
        ageVerification: ageVerificationAddress,
      },
      null,
      2
    )
  );

  console.log("\nBalance after:", hre.ethers.formatEther(await deployer.provider.getBalance(deployer.address)), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
