// Deploys the full platform stack in dependency order, on top of a base ETH
// balance already funded on the deployer wallet:
//   TrustRegistry(minimumStake)
//   -> NeuralHashSSI(trustRegistry)
//   -> InteractionHub(trustRegistry)
//   -> SchemaRegistry()
//   -> AgeOver18Groth16Verifier() -> AgeVerification(verifier)
//
// Then, using the deployer wallet itself:
//   - stakes the minimum and marks itself as a trusted issuer (so the app is
//     immediately usable without a manual follow-up step)
//   - registers the document schemas the frontend already knows about
//     on-chain, so SchemaRegistry isn't empty on first load
//
// Identity contracts are per-user and deployed separately, directly from the
// browser (see packages/web/app/guardian/page.tsx).
const hre = require("hardhat");

// Kept in sync with packages/web/app/documentSchemas.ts. Not imported
// directly since that file lives in a different workspace package.
const DOCUMENT_SCHEMAS = {
  "10th Marksheet": ["student_name", "board_name", "roll_number", "year_of_passing"],
  "12th Marksheet": ["student_name", "board_name", "roll_number", "stream"],
  Aadhaar: ["full_name", "aadhaar_number", "date_of_birth", "gender", "address"],
  Passport: ["full_name", "passport_number", "nationality", "date_of_birth", "date_of_expiry"],
  PAN: ["full_name", "pan_number", "date_of_birth", "father_name"],
  "Voter ID": ["full_name", "voter_id_number", "gender", "address"],
  "Driving License": [
    "full_name",
    "license_number",
    "date_of_birth",
    "date_of_expiry",
    "vehicle_class",
  ],
  "UG Marksheet": [
    "student_name",
    "university_name",
    "registration_number",
    "course_name",
    "cgpa_or_percentage",
  ],
  "PG Marksheet": [
    "student_name",
    "university_name",
    "registration_number",
    "course_name",
    "cgpa_or_percentage",
  ],
  "Diploma Certificate": [
    "student_name",
    "institute_name",
    "certificate_number",
    "course_name",
    "year_of_passing",
  ],
};

const MINIMUM_STAKE = hre.ethers.parseEther(
  process.env.TRUST_REGISTRY_MINIMUM_STAKE || "0.001"
);

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);

  section("Deploying contracts");

  const TrustRegistry = await hre.ethers.getContractFactory(
    "NeuralHashTrustRegistry"
  );
  const trustRegistry = await TrustRegistry.deploy(MINIMUM_STAKE);
  await trustRegistry.waitForDeployment();
  const trustRegistryAddress = await trustRegistry.getAddress();
  console.log("TrustRegistry deployed to:", trustRegistryAddress);

  const NeuralHashSSI = await hre.ethers.getContractFactory("NeuralHashSSI");
  const ssi = await NeuralHashSSI.deploy(trustRegistryAddress);
  await ssi.waitForDeployment();
  const ssiAddress = await ssi.getAddress();
  console.log("NeuralHashSSI deployed to:", ssiAddress);

  const InteractionHub = await hre.ethers.getContractFactory("InteractionHub");
  const hub = await InteractionHub.deploy(trustRegistryAddress);
  await hub.waitForDeployment();
  const hubAddress = await hub.getAddress();
  console.log("InteractionHub deployed to:", hubAddress);

  const SchemaRegistry = await hre.ethers.getContractFactory("SchemaRegistry");
  const schemaRegistry = await SchemaRegistry.deploy();
  await schemaRegistry.waitForDeployment();
  const schemaRegistryAddress = await schemaRegistry.getAddress();
  console.log("SchemaRegistry deployed to:", schemaRegistryAddress);

  const Groth16Verifier = await hre.ethers.getContractFactory(
    "AgeOver18Groth16Verifier"
  );
  const groth16Verifier = await Groth16Verifier.deploy();
  await groth16Verifier.waitForDeployment();
  const groth16VerifierAddress = await groth16Verifier.getAddress();
  console.log("AgeOver18Groth16Verifier deployed to:", groth16VerifierAddress);

  const AgeVerification = await hre.ethers.getContractFactory("AgeVerification");
  const ageVerification = await AgeVerification.deploy(groth16VerifierAddress, ssiAddress);
  await ageVerification.waitForDeployment();
  const ageVerificationAddress = await ageVerification.getAddress();
  console.log("AgeVerification deployed to:", ageVerificationAddress);

  section("Staking + trusting the deployer as an issuer");

  let tx = await trustRegistry.depositStake({ value: MINIMUM_STAKE });
  await tx.wait();
  console.log(`Deployer staked ${hre.ethers.formatEther(MINIMUM_STAKE)} ETH`);

  tx = await trustRegistry.setIssuer(
    deployer.address,
    "Sigil Deployer",
    "",
    true
  );
  await tx.wait();
  console.log("Deployer marked as trusted issuer");

  section("Registering document schemas on-chain");

  for (const [name, fields] of Object.entries(DOCUMENT_SCHEMAS)) {
    tx = await schemaRegistry.registerSchema(name, fields);
    await tx.wait();
    console.log(`Registered schema: ${name}`);
  }

  section("Deployment summary");
  console.log(
    JSON.stringify(
      {
        trustRegistry: trustRegistryAddress,
        neuralHashSSI: ssiAddress,
        interactionHub: hubAddress,
        schemaRegistry: schemaRegistryAddress,
        ageOver18Groth16Verifier: groth16VerifierAddress,
        ageVerification: ageVerificationAddress,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
