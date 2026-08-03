// ABI is generated from the compiled Hardhat artifact (fixes bug #7).
import abi from "./abi/TrustRegistry.json";

export const trustRegistryConfig = {
  address: process.env.NEXT_PUBLIC_TRUSTREGISTRY_ADDRESS as `0x${string}`,
  abi,
} as const;
