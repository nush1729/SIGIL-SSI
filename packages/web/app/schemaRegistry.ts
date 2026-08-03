// ABI is generated from the compiled Hardhat artifact (fixes bug #7).
import abi from "./abi/SchemaRegistry.json";

export const schemaRegistryConfig = {
  address: process.env.NEXT_PUBLIC_SCHEMA_REGISTRY_ADDRESS as `0x${string}`,
  abi,
} as const;
