// ABI is generated from the compiled Hardhat artifact (see
// packages/contracts/scripts/export-abi.js) instead of being hand-typed,
// so it can never drift from the deployed contract (fixes bug #7).
import abi from "./abi/NeuralHashSSI.json";

export const contractConfig = {
  address: process.env.NEXT_PUBLIC_SSI_ADDRESS as `0x${string}`,
  abi,
} as const;
