// Deploys a per-user Identity (guardian-recovery smart wallet) contract.
// Requires the platform's NeuralHashSSI to already be deployed (see deploy-all.js).
//
// Required env vars:
//   IDENTITY_OWNER_ADDRESS       - the wallet this Identity belongs to
//   IDENTITY_GUARDIAN_ADDRESSES  - comma-separated guardian addresses
//   IDENTITY_RECOVERY_THRESHOLD  - number of guardian votes needed to recover
//   SSI_REGISTRY_ADDRESS         - deployed NeuralHashSSI address
//
// Optional:
//   IDENTITY_RECOVERY_TIMELOCK_SECONDS - delay between guardian votes hitting
//     threshold and a recovery being finalizable (default: 3600 = 1 hour).
//     Gives the current owner a window to call cancelRecovery() if a
//     recovery was not one they authorized.
require("dotenv").config();
const { ethers } = require("hardhat");

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const owner = requireEnv("IDENTITY_OWNER_ADDRESS");
  const guardians = requireEnv("IDENTITY_GUARDIAN_ADDRESSES")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  const threshold = Number(requireEnv("IDENTITY_RECOVERY_THRESHOLD"));
  const ssiRegistryAddress = requireEnv("SSI_REGISTRY_ADDRESS");

  if (!ethers.isAddress(owner)) {
    throw new Error(`IDENTITY_OWNER_ADDRESS is not a valid address: ${owner}`);
  }
  guardians.forEach((address) => {
    if (!ethers.isAddress(address)) {
      throw new Error(`Guardian address is not valid: ${address}`);
    }
  });
  if (!ethers.isAddress(ssiRegistryAddress)) {
    throw new Error(
      `SSI_REGISTRY_ADDRESS is not a valid address: ${ssiRegistryAddress}`
    );
  }
  if (!Number.isInteger(threshold) || threshold <= 0 || threshold > guardians.length) {
    throw new Error(
      `IDENTITY_RECOVERY_THRESHOLD must be an integer between 1 and ${guardians.length}`
    );
  }

  const recoveryTimelockSeconds = Number(
    process.env.IDENTITY_RECOVERY_TIMELOCK_SECONDS || 3600
  );

  const Identity = await ethers.getContractFactory("Identity");
  const identity = await Identity.deploy(
    owner,
    guardians,
    threshold,
    ssiRegistryAddress,
    recoveryTimelockSeconds
  );

  await identity.waitForDeployment();

  console.log("Identity deployed to:", await identity.getAddress());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
