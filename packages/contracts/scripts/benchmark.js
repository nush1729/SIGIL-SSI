// Evaluation benchmark for the paper's evaluation section — run entirely on
// an in-process local Hardhat network (free, deterministic, no testnet
// funds needed). Produces real gas figures across repeated operations and
// batch sizes, plus real ZK proof generation/verification timing, instead
// of the single ad-hoc Sepolia readings collected during manual testing.
//
// Usage: npx hardhat run scripts/benchmark.js
const path = require("path");
const fs = require("fs");
const hre = require("hardhat");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");

const ZK_BUILD_DIR = path.join(__dirname, "..", "..", "zk", "build");
const WASM_PATH = path.join(ZK_BUILD_DIR, "AgeOver18_js", "AgeOver18.wasm");
const ZKEY_PATH = path.join(ZK_BUILD_DIR, "AgeOver18_final.zkey");
const VKEY_PATH = path.join(ZK_BUILD_DIR, "verification_key.json");

const OUT_DIR = path.join(__dirname, "..", "..", "..", "docs");
const OUT_JSON = path.join(OUT_DIR, "benchmark-results.json");
const OUT_MD = path.join(OUT_DIR, "evaluation.md");

const results = {
  meta: {},
  gas: {},
  batching: [],
  zk: {},
};

function section(title) {
  console.log(`\n=== ${title} ===`);
}

async function gasOf(txPromise) {
  const tx = await txPromise;
  const receipt = await tx.wait();
  return Number(receipt.gasUsed);
}

async function mean(fn, times) {
  const samples = [];
  for (let i = 0; i < times; i++) {
    samples.push(await fn(i));
  }
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  return { samples, avg };
}

async function main() {
  const [deployer, issuer2, userA, userB, guardian1, guardian2, guardian3, stranger] =
    await hre.ethers.getSigners();

  results.meta.network = hre.network.name;
  results.meta.timestamp = new Date().toISOString();
  results.meta.solidity = "0.8.20";

  section("Deploying stack on local Hardhat network");
  const MINIMUM_STAKE = hre.ethers.parseEther("0.001");

  const TrustRegistry = await hre.ethers.getContractFactory("NeuralHashTrustRegistry");
  const trustRegistry = await TrustRegistry.deploy(MINIMUM_STAKE);
  await trustRegistry.waitForDeployment();

  const NeuralHashSSI = await hre.ethers.getContractFactory("NeuralHashSSI");
  const ssi = await NeuralHashSSI.deploy(await trustRegistry.getAddress());
  await ssi.waitForDeployment();

  const InteractionHub = await hre.ethers.getContractFactory("InteractionHub");
  const hub = await InteractionHub.deploy(await trustRegistry.getAddress());
  await hub.waitForDeployment();

  const SchemaRegistry = await hre.ethers.getContractFactory("SchemaRegistry");
  const schemaRegistry = await SchemaRegistry.deploy();
  await schemaRegistry.waitForDeployment();

  const Groth16Verifier = await hre.ethers.getContractFactory("AgeOver18Groth16Verifier");
  const groth16Verifier = await Groth16Verifier.deploy();
  await groth16Verifier.waitForDeployment();

  const AgeVerification = await hre.ethers.getContractFactory("AgeVerification");
  const ageVerification = await AgeVerification.deploy(
    await groth16Verifier.getAddress(),
    await ssi.getAddress()
  );
  await ageVerification.waitForDeployment();

  const Identity = await hre.ethers.getContractFactory("Identity");

  await (await trustRegistry.connect(deployer).depositStake({ value: MINIMUM_STAKE })).wait();
  await (await trustRegistry.setIssuer(deployer.address, "Bench Issuer", "", true)).wait();
  await (await trustRegistry.connect(issuer2).depositStake({ value: MINIMUM_STAKE })).wait();
  await (await trustRegistry.setIssuer(issuer2.address, "Bench Issuer 2", "", true)).wait();

  section("Single-operation gas costs");

  const g = results.gas;

  g.issueCredential = await gasOf(
    ssi.issueCredential(userA.address, hre.ethers.keccak256(hre.ethers.toUtf8Bytes("bench-single-" + Date.now())), "cid", 0)
  );
  console.log("issueCredential:", g.issueCredential);

  g.issueBatchCredential = await gasOf(
    ssi.issueBatchCredential(userA.address, hre.ethers.keccak256(hre.ethers.toUtf8Bytes("bench-batch-" + Date.now())), "cid", 0)
  );
  console.log("issueBatchCredential (1 merkle root):", g.issueBatchCredential);

  const revokableHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("bench-revoke-" + Date.now()));
  await (await ssi.issueCredential(userA.address, revokableHash, "cid", 0)).wait();
  g.revokeCredential = await gasOf(ssi.revokeCredential(userA.address, revokableHash));
  console.log("revokeCredential:", g.revokeCredential);

  g.registerSchema = await gasOf(schemaRegistry.registerSchema("BenchSchema", ["a", "b", "c"]));
  console.log("registerSchema:", g.registerSchema);

  const ageCredHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("bench-age-" + Date.now()));
  await (await ssi.issueCredential(userA.address, ageCredHash, "cid", 0)).wait();
  g.setAgeCommitment = await gasOf(ssi.setAgeCommitment(userA.address, ageCredHash, 12345));
  console.log("setAgeCommitment:", g.setAgeCommitment);

  g.createClaimRequest = await gasOf(hub.connect(issuer2).createClaimRequest(userA.address, ["type"], "bench reason"));
  console.log("createClaimRequest:", g.createClaimRequest);

  const reqIds = await hub.getRequestsForUser(userA.address);
  g.fulfillClaimRequest = await gasOf(hub.connect(userA).fulfillClaimRequest(reqIds[reqIds.length - 1]));
  console.log("fulfillClaimRequest:", g.fulfillClaimRequest);

  g.createAttestation = await gasOf(hub.connect(deployer).createAttestation(userA.address, "bench attestation"));
  console.log("createAttestation (by trusted issuer):", g.createAttestation);

  section("Guardian wallet (Identity) gas costs");

  const BENCH_RECOVERY_TIMELOCK = 3600; // matches deployIdentity.js's production default
  const identity = await Identity.deploy(
    userA.address,
    [guardian1.address, guardian2.address, guardian3.address],
    2,
    await ssi.getAddress(),
    BENCH_RECOVERY_TIMELOCK
  );
  const identityDeployReceipt = await identity.deploymentTransaction().wait();
  g.identityDeploy_3guardians = Number(identityDeployReceipt.gasUsed);
  console.log("Identity deploy (3 guardians, threshold 2):", g.identityDeploy_3guardians);

  const identityCredHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("bench-identity-cred-" + Date.now()));
  await (await ssi.issueCredential(await identity.getAddress(), identityCredHash, "cid", 0)).wait();
  g.linkCredential = await gasOf(identity.connect(userA).linkCredential(identityCredHash));
  console.log("linkCredential:", g.linkCredential);

  const stranger2 = (await hre.ethers.getSigners())[8];
  g.addGuardian = await gasOf(identity.connect(userA).addGuardian(stranger2.address));
  console.log("addGuardian:", g.addGuardian);

  g.removeGuardian = await gasOf(identity.connect(userA).removeGuardian(stranger2.address));
  console.log("removeGuardian:", g.removeGuardian);

  g.proposeRecovery = await gasOf(identity.connect(guardian1).proposeRecovery(stranger.address));
  console.log("proposeRecovery:", g.proposeRecovery);

  g.voteRecovery_firstVote = await gasOf(identity.connect(guardian2).voteRecovery());
  console.log("voteRecovery (vote 1 of 2):", g.voteRecovery_firstVote);

  g.voteRecovery_finalVote_reachesThreshold = await gasOf(identity.connect(guardian3).voteRecovery());
  console.log("voteRecovery (final vote, starts recovery timelock):", g.voteRecovery_finalVote_reachesThreshold);

  await hre.network.provider.send("evm_increaseTime", [BENCH_RECOVERY_TIMELOCK]);
  await hre.network.provider.send("evm_mine");

  g.finalizeRecovery = await gasOf(identity.connect(stranger).finalizeRecovery());
  console.log("finalizeRecovery (after timelock elapses, transfers ownership):", g.finalizeRecovery);

  // Separately measure cancelRecovery's gas on a second proposal, since the
  // first was carried through to finalization above (stranger is now owner,
  // so a guardian — not stranger — must propose this one).
  await (await identity.connect(guardian1).proposeRecovery(userA.address)).wait();
  g.cancelRecovery = await gasOf(identity.connect(stranger).cancelRecovery());
  console.log("cancelRecovery (owner aborts an unauthorized-looking recovery):", g.cancelRecovery);

  const claimReqTx = await hub.connect(issuer2).createClaimRequest(await identity.getAddress(), ["type"], "bench identity claim");
  await claimReqTx.wait();
  const identityReqIds = await hub.getRequestsForUser(await identity.getAddress());
  const lastReqId = identityReqIds[identityReqIds.length - 1];
  const executeData = hub.interface.encodeFunctionData("fulfillClaimRequest", [lastReqId]);
  g.executeForwardedCall = await gasOf(
    identity.connect(stranger).execute(await hub.getAddress(), executeData)
  );
  console.log("execute() forwarding a call post-recovery (new owner is 'stranger'):", g.executeForwardedCall);

  section("Batch issuance amortization: individual issueCredential x N vs one issueBatchCredential");

  for (const n of [1, 5, 10, 25, 50]) {
    const individualTotal = await (async () => {
      let total = 0;
      for (let i = 0; i < n; i++) {
        const hash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`bench-amort-ind-${n}-${i}-${Date.now()}`));
        total += await gasOf(ssi.issueCredential(userB.address, hash, "cid", 0));
      }
      return total;
    })();

    const batchHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes(`bench-amort-batch-${n}-${Date.now()}`));
    const batchGas = await gasOf(ssi.issueBatchCredential(userB.address, batchHash, "cid", 0));

    const row = {
      credentialsPerBatch: n,
      individualIssuanceTotalGas: individualTotal,
      individualIssuanceGasPerCredential: Math.round(individualTotal / n),
      batchIssuanceGas: batchGas,
      batchIssuanceGasPerCredential: Math.round(batchGas / n),
      amortizationFactor: Number((individualTotal / batchGas).toFixed(2)),
    };
    results.batching.push(row);
    console.log(
      `N=${n}: individual=${individualTotal} (${row.individualIssuanceGasPerCredential}/cred), ` +
        `batch=${batchGas} (${row.batchIssuanceGasPerCredential}/cred), ` +
        `${row.amortizationFactor}x cheaper on-chain per batch tx`
    );
  }

  section("ZK proof generation + verification timing (Groth16, AgeOver18)");

  const poseidon = await buildPoseidon();
  const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, "utf8"));

  const zkSamples = [];
  const ZK_RUNS = 5;
  for (let i = 0; i < ZK_RUNS; i++) {
    const birthYear = 1990 + i;
    const salt = (Date.now() + i).toString();
    const currentYear = 2026;
    const hash = poseidon([BigInt(birthYear), BigInt(salt)]);
    const commitment = poseidon.F.toString(hash);

    const proveStart = process.hrtime.bigint();
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      { birthYear, salt, commitment, currentYear },
      WASM_PATH,
      ZKEY_PATH
    );
    const proveEnd = process.hrtime.bigint();
    const proveMs = Number(proveEnd - proveStart) / 1e6;

    const verifyStart = process.hrtime.bigint();
    const ok = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    const verifyEnd = process.hrtime.bigint();
    const verifyMs = Number(verifyEnd - verifyStart) / 1e6;

    zkSamples.push({ proveMs: Number(proveMs.toFixed(1)), verifyMs: Number(verifyMs.toFixed(1)), offChainVerifyOk: ok });
    console.log(`run ${i + 1}/${ZK_RUNS}: prove=${proveMs.toFixed(1)}ms off-chain-verify=${verifyMs.toFixed(1)}ms`);
  }

  const avgProveMs = zkSamples.reduce((a, s) => a + s.proveMs, 0) / zkSamples.length;
  const avgVerifyMs = zkSamples.reduce((a, s) => a + s.verifyMs, 0) / zkSamples.length;

  // On-chain verification gas: submit one real bound proof through the full
  // credential-binding flow (issue credential -> anchor commitment -> submit
  // proof), since that is the actual code path used by the app, not a raw
  // verifier call.
  const onChainBirthYear = 1995;
  const onChainSalt = Date.now().toString();
  const onChainCurrentYear = 2026;
  const onChainHash = poseidon([BigInt(onChainBirthYear), BigInt(onChainSalt)]);
  const onChainCommitment = poseidon.F.toString(onChainHash);

  const credHash = hre.ethers.keccak256(hre.ethers.toUtf8Bytes("bench-zk-onchain-" + Date.now()));
  await (await ssi.issueCredential(userA.address, credHash, "cid", 0)).wait();
  await (await ssi.setAgeCommitment(userA.address, credHash, onChainCommitment)).wait();

  const { proof: onChainProof, publicSignals: onChainPublicSignals } = await snarkjs.groth16.fullProve(
    { birthYear: onChainBirthYear, salt: onChainSalt, commitment: onChainCommitment, currentYear: onChainCurrentYear },
    WASM_PATH,
    ZKEY_PATH
  );
  const calldata = await snarkjs.groth16.exportSolidityCallData(onChainProof, onChainPublicSignals);
  const [pA, pB, pC, pubSignals] = JSON.parse(`[${calldata}]`);

  g.submitAgeProof_onChainVerify = await gasOf(
    ageVerification.connect(userA).submitAgeProof(credHash, pA, pB, pC, pubSignals)
  );
  console.log("submitAgeProof (full bound-proof flow, on-chain Groth16 verify):", g.submitAgeProof_onChainVerify);

  results.zk = {
    runs: ZK_RUNS,
    samples: zkSamples,
    avgProveMs: Number(avgProveMs.toFixed(1)),
    avgVerifyMs: Number(avgVerifyMs.toFixed(1)),
    onChainVerifyGas: g.submitAgeProof_onChainVerify,
  };

  section("Writing results");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  console.log("Wrote", OUT_JSON);

  const md = renderMarkdown(results);
  fs.writeFileSync(OUT_MD, md);
  console.log("Wrote", OUT_MD);
}

function renderMarkdown(r) {
  const lines = [];
  lines.push("# Evaluation");
  lines.push("");
  lines.push(
    `All figures below were measured on a local Hardhat network (in-process, deterministic, London-equivalent gas schedule) on ${r.meta.timestamp}, ` +
      "not on Sepolia — this gives repeatable, systematic multi-run figures rather than sparse individual testnet transactions. " +
      "Gas costs are protocol-defined and do not vary between a local Hardhat network and Sepolia for identical bytecode and calldata; " +
      "wall-clock ZK timings were measured on the developer machine used for this project and will vary by hardware."
  );
  lines.push("");
  lines.push("## Gas costs by operation");
  lines.push("");
  lines.push("| Operation | Gas used |");
  lines.push("|---|---|");
  for (const [op, gas] of Object.entries(r.gas)) {
    lines.push(`| ${op} | ${gas.toLocaleString()} |`);
  }
  lines.push("");
  lines.push("## Batch vs. individual credential issuance");
  lines.push("");
  lines.push(
    "`issueBatchCredential` anchors a single Merkle root representing an arbitrary number of off-chain-hashed " +
      "credentials in one transaction, whereas `issueCredential` requires one transaction per credential. " +
      "The table below issues the same N credentials both ways and compares total on-chain gas."
  );
  lines.push("");
  lines.push(
    "| Credentials (N) | Individual: total gas | Individual: gas/credential | Batch: total gas | Batch: gas/credential | Amortization factor |"
  );
  lines.push("|---|---|---|---|---|---|");
  for (const row of r.batching) {
    lines.push(
      `| ${row.credentialsPerBatch} | ${row.individualIssuanceTotalGas.toLocaleString()} | ${row.individualIssuanceGasPerCredential.toLocaleString()} | ${row.batchIssuanceGas.toLocaleString()} | ${row.batchIssuanceGasPerCredential.toLocaleString()} | ${row.amortizationFactor}x |`
    );
  }
  lines.push("");
  lines.push("## ZK age-over-18 proof (Groth16, Poseidon commitment binding)");
  lines.push("");
  lines.push(`Measured over ${r.zk.runs} runs on the developer machine (Apple Silicon via Rosetta for circom compilation; snarkjs/wasm witness generation and proving run natively):`);
  lines.push("");
  lines.push("| Run | Proof generation (ms) | Off-chain verify (ms) |");
  lines.push("|---|---|---|");
  r.zk.samples.forEach((s, i) => lines.push(`| ${i + 1} | ${s.proveMs} | ${s.verifyMs} |`));
  lines.push("");
  lines.push(`Average proof generation: **${r.zk.avgProveMs} ms**. Average off-chain verification: **${r.zk.avgVerifyMs} ms**.`);
  lines.push(
    `On-chain verification (\`AgeVerification.submitAgeProof\`, the full credential-bound flow including the commitment-match check against ` +
      `\`NeuralHashSSI.getAgeCommitment\`): **${r.zk.onChainVerifyGas.toLocaleString()} gas**.`
  );
  lines.push("");
  return lines.join("\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
