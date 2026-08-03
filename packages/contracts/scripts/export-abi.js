// Copies compiled ABI JSON out of Hardhat's artifacts into the frontend
// package, so the frontend never hand-types contract ABIs (fixes bug #7).
// Run this after `hardhat compile` (see package.json's `compile` script).
const fs = require("fs");
const path = require("path");

const CONTRACTS_DIR = path.join(__dirname, "..", "artifacts", "contracts");
const OUT_DIR = path.join(__dirname, "..", "..", "web", "app", "abi");

// { sourceFile: contractName, ... } -> output file name in packages/web/app/abi
const EXPORTS = {
  "NeuralHashSSI.sol/NeuralHashSSI.json": "NeuralHashSSI.json",
  "Identity.sol/Identity.json": "Identity.json",
  "InteractionHub.sol/InteractionHub.json": "InteractionHub.json",
  "TrustRegistry.sol/NeuralHashTrustRegistry.json": "TrustRegistry.json",
  "SchemaRegistry.sol/SchemaRegistry.json": "SchemaRegistry.json",
  "AgeVerification.sol/AgeVerification.json": "AgeVerification.json",
};

function main() {
  if (!fs.existsSync(CONTRACTS_DIR)) {
    throw new Error(
      `Artifacts not found at ${CONTRACTS_DIR}. Run "hardhat compile" first.`
    );
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const [artifactRelPath, outFileName] of Object.entries(EXPORTS)) {
    const artifactPath = path.join(CONTRACTS_DIR, artifactRelPath);
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

    const outPath = path.join(OUT_DIR, outFileName);
    fs.writeFileSync(outPath, JSON.stringify(artifact.abi, null, 2) + "\n");
    console.log(`Wrote ${outFileName} (${artifact.abi.length} entries)`);
  }

  // Identity is deployed per-user directly from the browser (see
  // app/identity.ts), so the frontend also needs its creation bytecode.
  const identityArtifact = JSON.parse(
    fs.readFileSync(
      path.join(CONTRACTS_DIR, "Identity.sol/Identity.json"),
      "utf8"
    )
  );
  fs.writeFileSync(
    path.join(OUT_DIR, "Identity.bytecode.json"),
    JSON.stringify({ bytecode: identityArtifact.bytecode }, null, 2) + "\n"
  );
  console.log("Wrote Identity.bytecode.json");
}

main();
