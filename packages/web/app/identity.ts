// ABI + bytecode generated from the compiled Hardhat artifact (fixes bug #7).
//
// Unlike NeuralHashSSI/TrustRegistry/InteractionHub, Identity is a per-user
// contract — there is no single deployed address for the app. Each wallet
// deploys its own Identity instance from the browser (see
// deployIdentityForOwner in identityStorage.ts), and we remember the
// resulting address locally per-owner-address.
import identityAbi from "./abi/Identity.json";
import identityBytecodeJson from "./abi/Identity.bytecode.json";

export const identityConfig = {
  abi: identityAbi,
} as const;

export const identityBytecode = identityBytecodeJson.bytecode as `0x${string}`;
