require("dotenv").config();
const { ethers } = require("hardhat");

const CURRENT_AGE_VERIFICATION = "0x8ED0488f2Ac061f05Fa88E08a6eb7f421d4CC45a";

async function main() {
  const av = await (await ethers.getContractFactory("AgeVerification")).attach(
    CURRENT_AGE_VERIFICATION
  );
  console.log("Current AgeVerification.verifier (Groth16Verifier address):", await av.verifier());
  console.log("Current AgeVerification.ssiRegistry:", await av.ssiRegistry());
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
