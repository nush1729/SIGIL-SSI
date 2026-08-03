// ABI is generated from the compiled Hardhat artifact (fixes bug #7).
import abi from "./abi/AgeVerification.json";

export const ageVerificationConfig = {
  address: process.env.NEXT_PUBLIC_AGE_VERIFICATION_ADDRESS as `0x${string}`,
  abi,
} as const;
