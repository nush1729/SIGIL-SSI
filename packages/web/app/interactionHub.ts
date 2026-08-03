// ABI is generated from the compiled Hardhat artifact (fixes bug #7).
import abi from "./abi/InteractionHub.json";

export const interactionHubConfig = {
  address: process.env.NEXT_PUBLIC_INTERACTIONHUB_ADDRESS as `0x${string}`,
  abi,
} as const;
