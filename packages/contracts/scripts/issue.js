// Issues a single test credential via an already-deployed NeuralHashSSI.
// NOTE: NeuralHashSSI.issueCredential is gated behind TrustRegistry.isTrusted —
// the signer running this script must already be marked trusted via
// TrustRegistry.setIssuer(signerAddress, ..., true) or this will revert.
//
// Required env vars:
//   SSI_REGISTRY_ADDRESS - deployed NeuralHashSSI address
//   RECIPIENT_ADDRESS    - wallet the credential is issued to
require("dotenv").config();
const hre = require("hardhat");
const { ethers } = hre;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const contractAddress = requireEnv("SSI_REGISTRY_ADDRESS");
  const userAddress = requireEnv("RECIPIENT_ADDRESS");

  if (!ethers.isAddress(contractAddress) || !ethers.isAddress(userAddress)) {
    throw new Error("SSI_REGISTRY_ADDRESS and RECIPIENT_ADDRESS must be valid addresses");
  }

  const Contract = await ethers.getContractFactory("NeuralHashSSI");
  const contract = await Contract.attach(contractAddress);

  const credential = {
    type: "Degree",
    name: "Aditi Saxena",
    university: "ABC University",
    year: 2026
  };

  const hash = ethers.keccak256(
    ethers.toUtf8Bytes(JSON.stringify(credential))
  );

  const tx = await contract.issueCredential(
    userAddress,
    hash,
    "fakeCID123"
  );

  await tx.wait();

  console.log("Credential issued successfully!");
}

main().catch(console.error);
