# Sigil ZK — Age Over 18 Predicate Proof

A minimal circom + snarkjs (Groth16) circuit proving `currentYear - birthYear
>= 18` from a private `(birthYear, salt)` pair whose Poseidon commitment is
public. The verifier never sees the birth year — only the commitment and a
pass/fail result.

The built artifacts (`.wasm`, `.zkey`) are already committed to `build/` and
copied into `packages/web/zk-artifacts/` for the frontend's API route to use.
You don't need to rebuild anything to run the app — this is only for
modifying the circuit itself.

## Rebuilding

Requires `circom` (the compiler). On macOS, if you don't have it:

```bash
mkdir -p bin
curl -L -o bin/circom https://github.com/iden3/circom/releases/download/v2.2.3/circom-macos-amd64
chmod +x bin/circom
```

(Runs fine under Rosetta on Apple Silicon — no native arm64 build exists.)

```bash
# 1. Compile the circuit
./bin/circom circuits/AgeOver18.circom --r1cs --wasm --sym -o build -l node_modules

# 2. Trusted setup — download a public Powers-of-Tau file (phase 1, reused
#    ceremony, not generated fresh) sized for this circuit (~555 constraints,
#    power 12 / 4096 is comfortably enough):
curl -L -o build/pot12_final.ptau https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau

# 3. Phase 2 setup + a single contribution (fine for a demo circuit; a real
#    deployment would want a multi-party ceremony)
npx snarkjs groth16 setup build/AgeOver18.r1cs build/pot12_final.ptau build/AgeOver18_0000.zkey
npx snarkjs zkey contribute build/AgeOver18_0000.zkey build/AgeOver18_final.zkey --name="contribution" -e="$(openssl rand -hex 32)"

# 4. Export the verification key + Solidity verifier
npx snarkjs zkey export verificationkey build/AgeOver18_final.zkey build/verification_key.json
npx snarkjs zkey export solidityverifier build/AgeOver18_final.zkey build/AgeVerifier.sol

# 5. Copy what the app needs
cp build/AgeVerifier.sol ../contracts/contracts/AgeVerifier.sol   # then rename the contract if desired
cp build/AgeOver18_js/AgeOver18.wasm build/AgeOver18_final.zkey ../web/zk-artifacts/
```

Then re-run `pnpm --filter sigil-contracts run compile` and redeploy.

## Testing locally without touching the chain

```bash
node scripts/test-local-proof.js
```

Generates a valid proof (age 26), verifies it, confirms an underage claim
(age 11) cannot even produce a witness (not just "verifier rejects it" — the
circuit itself makes it impossible), and confirms a tampered public input
fails verification.
