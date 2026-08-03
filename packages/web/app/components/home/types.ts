export type Credential = {
  ipfsCID: string
  issuer: `0x${string}`
  isValid: boolean
  issuedAt: bigint
  credentialHash: `0x${string}`
  isBatch: boolean
  expiresAt: bigint
}

export function isCredentialExpired(credential: Pick<Credential, 'expiresAt'>): boolean {
  if (credential.expiresAt === BigInt(0)) {
    return false
  }
  return credential.expiresAt <= BigInt(Math.floor(Date.now() / 1000))
}
