require("dotenv").config();
const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const provider = deployer.provider;
  const balance = await provider.getBalance(deployer.address);
  const feeData = await provider.getFeeData();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH");
  console.log("gasPrice:", feeData.gasPrice ? ethers.formatUnits(feeData.gasPrice, "gwei") : "n/a", "gwei");
  console.log(
    "maxFeePerGas:",
    feeData.maxFeePerGas ? ethers.formatUnits(feeData.maxFeePerGas, "gwei") : "n/a",
    "gwei"
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
