// Sanity-checks the whole circuit lifecycle locally, before wiring into the
// frontend or deploying the Solidity verifier: computes a Poseidon
// commitment, generates a witness + Groth16 proof for a valid (>= 18) case,
// verifies it with snarkjs, and confirms an underage case cannot even
// produce a witness (the circuit itself rejects it, not just the verifier).
const path = require("path");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const BUILD_DIR = path.join(__dirname, "..", "build");
const WASM_PATH = path.join(BUILD_DIR, "AgeOver18_js", "AgeOver18.wasm");
const ZKEY_PATH = path.join(BUILD_DIR, "AgeOver18_final.zkey");
const VKEY_PATH = path.join(BUILD_DIR, "verification_key.json");

async function poseidonCommitment(poseidon, birthYear, salt) {
  const hash = poseidon([BigInt(birthYear), BigInt(salt)]);
  return poseidon.F.toString(hash);
}

async function main() {
  const poseidon = await buildPoseidon();

  console.log("=== Case 1: birthYear=2000, currentYear=2026 (age 26, should PROVE) ===");
  const birthYear1 = 2000;
  const salt1 = "123456789012345";
  const currentYear1 = 2026;
  const commitment1 = await poseidonCommitment(poseidon, birthYear1, salt1);

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { birthYear: birthYear1, salt: salt1, commitment: commitment1, currentYear: currentYear1 },
    WASM_PATH,
    ZKEY_PATH
  );

  console.log("Proof generated. Public signals:", publicSignals);

  const vkey = JSON.parse(require("fs").readFileSync(VKEY_PATH, "utf8"));
  const valid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
  console.log("snarkjs verify result (expect true):", valid);

  console.log("\n=== Case 2: birthYear=2015, currentYear=2026 (age 11, should FAIL to prove) ===");
  const birthYear2 = 2015;
  const salt2 = "987654321098765";
  const currentYear2 = 2026;
  const commitment2 = await poseidonCommitment(poseidon, birthYear2, salt2);

  try {
    await snarkjs.groth16.fullProve(
      { birthYear: birthYear2, salt: salt2, commitment: commitment2, currentYear: currentYear2 },
      WASM_PATH,
      ZKEY_PATH
    );
    console.log("UNEXPECTED: proof generation succeeded for an underage input!");
    process.exitCode = 1;
  } catch (err) {
    console.log("Expected failure — witness generation rejected the underage claim.");
    console.log("Error (truncated):", String(err.message || err).slice(0, 200));
  }

  console.log("\n=== Case 3: tampered public input (wrong commitment) should fail verification ===");
  const wrongPublicSignals = [...publicSignals];
  wrongPublicSignals[0] = "1234567890123456789012345678901234567890"; // bogus commitment
  const tamperedValid = await snarkjs.groth16.verify(vkey, wrongPublicSignals, proof);
  console.log("snarkjs verify result for tampered input (expect false):", tamperedValid);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
