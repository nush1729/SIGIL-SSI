// Reads a user's credentials from an already-deployed NeuralHashSSI.
//
// Required env vars:
//   SSI_REGISTRY_ADDRESS - deployed NeuralHashSSI address
//   RECIPIENT_ADDRESS    - wallet whose credentials to read
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

  const creds = await contract.getUserCredentials(userAddress);

  console.log("User Credentials:", creds);
}

main().catch(console.error);
