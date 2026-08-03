// Live test of SchemaRegistry (read-only, free) and the credential-bound
// AgeVerification flow (issue a credential, anchor its age commitment as the
// issuer, generate + submit a real Groth16 proof as the holder) against the
// deployed Sepolia stack.
require("dotenv").config();
const path = require("path");
const { ethers } = require("hardhat");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const SSI_ADDRESS =
  process.env.SSI_REGISTRY_ADDRESS || "0xa9025B3065785aEdb2Ac08017cF1a6F943deAfd3";
const SCHEMA_REGISTRY_ADDRESS =
  process.env.SCHEMA_REGISTRY_ADDRESS || "0x621eb069e5369b77D9D074cB11A3eD6985c636d1";
const AGE_VERIFICATION_ADDRESS =
  process.env.AGE_VERIFICATION_ADDRESS || "0x8ED0488f2Ac061f05Fa88E08a6eb7f421d4CC45a";

const ZK_BUILD_DIR = path.join(__dirname, "..", "..", "zk", "build");
const WASM_PATH = path.join(ZK_BUILD_DIR, "AgeOver18_js", "AgeOver18.wasm");
const ZKEY_PATH = path.join(ZK_BUILD_DIR, "AgeOver18_final.zkey");

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Using wallet (acting as both issuer and holder here):", signer.address);

  section("SchemaRegistry: read on-chain schemas");
  const schemaRegistry = await (
    await ethers.getContractFactory("SchemaRegistry")
  ).attach(SCHEMA_REGISTRY_ADDRESS);

  const names = await schemaRegistry.getAllSchemaNames();
  console.log("Registered schema names:", names);

  const passportSchema = await schemaRegistry.getSchema("Passport");
  console.log("Passport schema fields:", passportSchema.fields, "version:", passportSchema.version.toString());

  section("Issue a credential to anchor an age commitment against (credential-binding fix)");
  const ssi = await (await ethers.getContractFactory("NeuralHashSSI")).attach(SSI_ADDRESS);

  const idCredential = { type: "Aadhaar", date_of_birth: "1995-04-12", nonce: Date.now() };
  const credentialHash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(idCredential)));
  let tx = await ssi.issueCredential(signer.address, credentialHash, "e2e-zk-id-cid", 0);
  await tx.wait();
  console.log("Issued ID credential:", credentialHash);

  const poseidon = await buildPoseidon();
  const birthYear = 1995;
  const salt = Date.now().toString();
  const currentYear = 2026;

  const hash = poseidon([BigInt(birthYear), BigInt(salt)]);
  const commitment = poseidon.F.toString(hash);

  tx = await ssi.setAgeCommitment(signer.address, credentialHash, commitment);
  await tx.wait();
  console.log("Issuer anchored age commitment on the credential:", commitment);

  section("Holder: generate + submit a real Groth16 proof bound to that credential");
  const ageVerification = await (
    await ethers.getContractFactory("AgeVerification")
  ).attach(AGE_VERIFICATION_ADDRESS);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { birthYear, salt, commitment, currentYear },
    WASM_PATH,
    ZKEY_PATH
  );

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals);
  const [pA, pB, pC, pubSignals] = JSON.parse(`[${calldata}]`);

  tx = await ageVerification.submitAgeProof(credentialHash, pA, pB, pC, pubSignals);
  const receipt = await tx.wait();
  console.log("submitAgeProof tx:", receipt.hash, "block", receipt.blockNumber, "gasUsed:", receipt.gasUsed.toString());

  const isVerified = await ageVerification.isAgeVerified(signer.address);
  const verifiedYear = await ageVerification.verifiedAtYear(signer.address);
  const credentialUsed = await ageVerification.credentialUsed(signer.address);
  console.log("isAgeVerified(signer):", isVerified);
  console.log("verifiedAtYear(signer):", verifiedYear.toString());
  console.log("credentialUsed(signer) matches issued credential:", credentialUsed === credentialHash);

  section("Negative check: a proof for a fabricated birth year on the SAME credential must be rejected");
  const fabricatedSalt = (Date.now() + 1).toString();
  const fabricatedYear = 1985;
  const fabHash = poseidon([BigInt(fabricatedYear), BigInt(fabricatedSalt)]);
  const fabCommitment = poseidon.F.toString(fabHash);

  const { proof: fabProof, publicSignals: fabPublicSignals } = await snarkjs.groth16.fullProve(
    { birthYear: fabricatedYear, salt: fabricatedSalt, commitment: fabCommitment, currentYear },
    WASM_PATH,
    ZKEY_PATH
  );
  const fabCalldata = await snarkjs.groth16.exportSolidityCallData(fabProof, fabPublicSignals);
  const [fabPA, fabPB, fabPC, fabPubSignals] = JSON.parse(`[${fabCalldata}]`);

  let rejectedFabricated = false;
  try {
    await ageVerification.submitAgeProof(credentialHash, fabPA, fabPB, fabPC, fabPubSignals);
  } catch (err) {
    rejectedFabricated = true;
    console.log("Correctly rejected (expected 'Commitment does not match credential'):", err.shortMessage || err.message);
  }
  console.log("Fabricated-birth-year proof rejected:", rejectedFabricated);

  section("DONE — SchemaRegistry + credential-bound AgeVerification confirmed live");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
