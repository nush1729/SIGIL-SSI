'use client'

import { Suspense } from 'react'
import { useState, useEffect } from 'react'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { useAccount, useConfig, useDisconnect, useWriteContract } from 'wagmi'
import { isAddress, keccak256, stringToBytes } from 'viem'
import { useSearchParams, useRouter } from 'next/navigation'
import { contractConfig } from '../../contract'
import { interactionHubConfig } from '../../interactionHub'
import { trustRegistryConfig } from '../../trustRegistry'
import { ageVerificationConfig } from '../../ageVerification'
import { generateAgeProof } from '../../zkProve'
import { authenticateWithBiometric } from '../../biometricAuth'
import { uploadToIPFS } from '../../ipfs'
import { ViewToggle } from '../../components/home/ViewToggle'
import { CredentialsSection } from '../../components/home/CredentialsSection'
import { isCredentialExpired } from '../../components/home/types'
import DecryptedText from '../../components/home/DecryptedText'
import { useToast } from '../../components/ui/ToastProvider'

type Credential = {
  ipfsCID: string
  issuer: `0x${string}`
  isValid: boolean
  issuedAt: bigint
  credentialHash: `0x${string}`
  isBatch: boolean
  expiresAt: bigint
}

type BatchEntry = {
  credential: Record<string, unknown>
  leaf: `0x${string}`
  proof: `0x${string}`[]
}

type BatchVerificationEntry = {
  leaf: `0x${string}`
  credential: Record<string, unknown>
  included: boolean
}

// Bundles several (possibly cross-issuer) credentials belonging to one
// subject into a single shareable IPFS document — a "verifiable
// presentation" the holder can hand to a verifier in one link instead of
// sharing each credential individually. Scoped to single (non-batch)
// credentials for this project: batch credentials would additionally need
// their Merkle leaf + proof carried along, which the current issuance flow
// doesn't retain a lookup path for outside the original batch's IPFS payload.
type PresentationEntry = {
  credentialHash: `0x${string}`
  ipfsCID: string
  issuer: `0x${string}`
}

type Presentation = {
  subject: `0x${string}`
  createdAt: string
  credentials: PresentationEntry[]
}

type PresentationVerifyEntry = PresentationEntry & {
  valid: boolean
  issuerTrusted: boolean
}

type AttestationTuple = readonly [
  `0x${string}`,
  `0x${string}`,
  string,
  bigint,
]

type AttestationObject = {
  attester?: `0x${string}`
  statement?: string
  createdAt?: bigint
}

// getAttestations returns a struct[] with every field named, which viem
// decodes as an array of named objects, not positional tuples — indexing
// by position (attestation[2]) crashes at runtime. Same shape handled
// defensively in interactions/page.tsx for the identical contract call.
function isAttestationTuple(value: AttestationTuple | AttestationObject): value is AttestationTuple {
  return Array.isArray(value)
}

type SharedCidRecord = {
  cid: string
  from: `0x${string}`
  timestamp: bigint
}

type DisclosedData = Record<string, unknown>
const CREDENTIALS_PER_PAGE = 5
const PUBLIC_DISCLOSURE_FIELDS = new Set(['type', 'documentType', 'year'])

function maskCid(cid: string) {
  if (cid.length <= 18) {
    return cid
  }
  return `${cid.slice(0, 10)}...${cid.slice(-8)}`
}

export default function VerifyPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-transparent p-6 text-violet-100/80">
          Loading verifier portal...
        </div>
      }
    >
      <VerifyPageContent />
    </Suspense>
  )
}

function VerifyPageContent() {
  const { address: connectedAddress } = useAccount()
  const config = useConfig()
  const { disconnect } = useDisconnect()
  const { writeContractAsync } = useWriteContract()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()

  const [ageEligibleCredentials, setAgeEligibleCredentials] = useState<
    { credentialHash: `0x${string}`; ipfsCID: string }[]
  >([])
  const [loadingAgeEligible, setLoadingAgeEligible] = useState(false)
  const [selectedAgeCredential, setSelectedAgeCredential] = useState('')
  const [provingAge, setProvingAge] = useState(false)
  const [provingAgeStage, setProvingAgeStage] = useState<'fetching' | 'proving' | 'submitting' | null>(null)
  const [ageCheckAddress, setAgeCheckAddress] = useState('')
  const [ageVerifiedResult, setAgeVerifiedResult] = useState<boolean | null>(null)
  const [checkingAge, setCheckingAge] = useState(false)

  const userParam = searchParams.get('user')
  const hashParam = searchParams.get('hash')

  const [disclosedData, setDisclosedData] = useState<DisclosedData | null>(null)
  const [disclosedCredentialIndex, setDisclosedCredentialIndex] = useState<number | null>(null)
  const [inputAddress, setInputAddress] = useState('')
  const [credentials, setCredentials] = useState<Credential[]>([])
  const [issuerTrustMap, setIssuerTrustMap] = useState<Record<string, boolean>>({})
  const [verificationResult, setVerificationResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [sharedCids, setSharedCids] = useState<SharedCidRecord[]>([])
  const [sharedCidsLoading, setSharedCidsLoading] = useState(false)
  const [biometricLoadingIndex, setBiometricLoadingIndex] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [credentialOwnerAddress, setCredentialOwnerAddress] = useState<`0x${string}` | null>(null)
  const [batchVerificationIndex, setBatchVerificationIndex] = useState<number | null>(null)
  const [batchVerificationResults, setBatchVerificationResults] = useState<BatchVerificationEntry[] | null>(null)
  const [batchVerifying, setBatchVerifying] = useState(false)

  const [selectedForPresentation, setSelectedForPresentation] = useState<Set<string>>(new Set())
  const [buildingPresentation, setBuildingPresentation] = useState(false)
  const [presentationCid, setPresentationCid] = useState<string | null>(null)
  const [presentationCidInput, setPresentationCidInput] = useState('')
  const [loadingPresentation, setLoadingPresentation] = useState(false)
  const [presentationResults, setPresentationResults] = useState<PresentationVerifyEntry[] | null>(null)

  async function loadSharedCids(addressToFetch: `0x${string}`) {
    try {
      setSharedCidsLoading(true)

      const data = await readContract(config, {
        ...interactionHubConfig,
        functionName: 'getAttestations',
        args: [addressToFetch],
      })

      const records = (data as readonly (AttestationTuple | AttestationObject)[])
        .map((attestation) => {
          const statement = (isAttestationTuple(attestation) ? attestation[2] : attestation.statement) ?? ''
          const from = isAttestationTuple(attestation) ? attestation[0] : attestation.attester
          const timestamp = isAttestationTuple(attestation) ? attestation[3] : attestation.createdAt
          const prefix = 'selected_cid:'

          if (!statement.startsWith(prefix) || !from || timestamp === undefined) {
            return null
          }

          const cid = statement.slice(prefix.length).trim()
          if (!cid) {
            return null
          }

          return { cid, from, timestamp } satisfies SharedCidRecord
        })
        .filter((entry): entry is SharedCidRecord => Boolean(entry))

      setSharedCids(records)
    } catch (error) {
      console.error(error)
      setSharedCids([])
    } finally {
      setSharedCidsLoading(false)
    }
  }

  async function checkIssuerTrust(issuer: `0x${string}`) {
    try {
      const trusted = await readContract(config, {
        ...trustRegistryConfig,
        functionName: 'isTrusted',
        args: [issuer],
      })

      return Boolean(trusted)
    } catch (err) {
      console.error(err)
      return false
    }
  }

  async function resolveIssuerTrust(creds: Credential[]) {
    if (!creds.length) {
      setIssuerTrustMap({})
      return
    }

    const issuers = Array.from(new Set(creds.map((cred) => cred.issuer.toLowerCase()))) as `0x${string}`[]

    const entries = await Promise.all(
      issuers.map(async (issuer) => {
        const trusted = await checkIssuerTrust(issuer)
        return [issuer, trusted] as const
      })
    )

    setIssuerTrustMap(Object.fromEntries(entries))
  }

  // ---------------- AUTO FILL ADDRESS ----------------
  useEffect(() => {
    if (userParam) {
      const normalizedAddress = userParam.trim()
      setInputAddress(normalizedAddress)
      fetchCredentials(normalizedAddress)
    }
  }, [userParam])

  useEffect(() => {
    if (!userParam && connectedAddress && !inputAddress.trim()) {
      const normalizedAddress = connectedAddress.trim()
      setInputAddress(normalizedAddress)
      void fetchCredentials(normalizedAddress)
    }
  }, [userParam, connectedAddress, inputAddress])

  // ---------------- FETCH CREDENTIALS ----------------
  async function fetchCredentials(addressToFetch?: string) {
    const address = (addressToFetch || inputAddress).trim()
    if (!address) return
    if (!isAddress(address)) {
      setCredentials([])
      setCredentialOwnerAddress(null)
      setIssuerTrustMap({})
      setDisclosedData(null)
      setDisclosedCredentialIndex(null)
      setVerificationResult(null)
      setCurrentPage(1)
      toast.error('Please enter a valid wallet address.')
      return
    }

    try {
      setLoading(true)
      setDisclosedData(null)
      setDisclosedCredentialIndex(null)
      setVerificationResult(null)

      const data = await readContract(config, {
        ...contractConfig,
        functionName: 'getUserCredentials',
        args: [address as `0x${string}`],
      })

      const creds = data as Credential[]
      setCurrentPage(1)
      setCredentials(creds)
      setCredentialOwnerAddress(address as `0x${string}`)
      await resolveIssuerTrust(creds)
      await loadSharedCids(address as `0x${string}`)

      // 🔥 AUTO VERIFY IF HASH PROVIDED
      const normalizedUserParam = userParam?.trim().toLowerCase()
      const shouldAutoVerifyFromQuery =
        Boolean(hashParam) &&
        Boolean(normalizedUserParam) &&
        address.toLowerCase() === normalizedUserParam

      if (shouldAutoVerifyFromQuery) {
        const index = creds.findIndex(
          (cred) => cred.credentialHash === hashParam
        )

        if (index !== -1) {
          await verifyCredential(index, creds)
        }
      }

    } catch (err) {
      console.error(err)
      toast.error('Failed to fetch credentials.')
    } finally {
      setLoading(false)
    }
  }

  const totalPages = Math.max(1, Math.ceil(credentials.length / CREDENTIALS_PER_PAGE))
  const currentPageStart = (currentPage - 1) * CREDENTIALS_PER_PAGE
  const paginatedCredentials = credentials.slice(currentPageStart, currentPageStart + CREDENTIALS_PER_PAGE)
  const currentPageEnd = Math.min(currentPageStart + paginatedCredentials.length, credentials.length)

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages)
    }
  }, [currentPage, totalPages])

  // ---------------- VERIFY ----------------
  async function verifyCredential(
    index: number,
    credsOverride?: Credential[]
  ) {
    const creds = credsOverride || credentials
    const cred = creds[index]
    if (!cred) {
      toast.error('Credential record not found.')
      return
    }

    if (!cred.isValid) {
      setVerificationResult('❌ Credential Revoked')
      return
    }

    if (isCredentialExpired(cred)) {
      setVerificationResult('❌ Credential Expired')
      return
    }

    try {
      const res = await fetch(
        `https://gateway.pinata.cloud/ipfs/${cred.ipfsCID}`
      )
      if (!res.ok) {
        throw new Error('Unable to fetch credential payload from IPFS.')
      }

      const json = await res.json()

      const recomputedHash = keccak256(
        stringToBytes(JSON.stringify(json))
      )

      const isIssuerTrusted = await checkIssuerTrust(cred.issuer)
      const trustMessage = isIssuerTrusted
        ? 'Issuer is trusted ✅'
        : 'Issuer is not trusted ❌'

      if (recomputedHash === cred.credentialHash) {
        setVerificationResult(`✅ Credential Verified (Authentic) | ${trustMessage}`)
      } else {
        setVerificationResult(`❌ Credential Tampered | ${trustMessage}`)
      }

    } catch (err) {
      console.error(err)
      setVerificationResult('❌ Failed to fetch IPFS document')
    }
  }

  // Verifies each credential in a Merkle-batch by checking on-chain that its
  // leaf is included under the anchored root via NeuralHashSSI.verifyBatchInclusion
  // (fixes bug #3 — real Merkle proof verification instead of anchor-only trust).
  async function verifyBatchCredential(index: number) {
    const cred = credentials[index]
    if (!cred || !credentialOwnerAddress) {
      toast.error('Credential record not found.')
      return
    }

    if (!cred.isValid) {
      setVerificationResult('❌ Batch Revoked')
      return
    }

    try {
      setBatchVerifying(true)
      setBatchVerificationIndex(index)
      setBatchVerificationResults(null)

      const res = await fetch(`https://gateway.pinata.cloud/ipfs/${cred.ipfsCID}`)
      if (!res.ok) {
        throw new Error('Unable to fetch batch payload from IPFS.')
      }

      const payload = (await res.json()) as { root: string; credentials: BatchEntry[] }

      const results = await Promise.all(
        payload.credentials.map(async (entry) => {
          const included = await readContract(config, {
            ...contractConfig,
            functionName: 'verifyBatchInclusion',
            args: [
              credentialOwnerAddress,
              cred.credentialHash,
              entry.leaf,
              entry.proof,
            ],
          })

          return {
            leaf: entry.leaf,
            credential: entry.credential,
            included: Boolean(included),
          } satisfies BatchVerificationEntry
        })
      )

      setBatchVerificationResults(results)
    } catch (err) {
      console.error(err)
      toast.error('Failed to verify batch inclusion.')
    } finally {
      setBatchVerifying(false)
    }
  }

  // ---------------- VERIFIABLE PRESENTATIONS ----------------

  function togglePresentationSelection(credentialHash: string) {
    setSelectedForPresentation((prev) => {
      const next = new Set(prev)
      if (next.has(credentialHash)) {
        next.delete(credentialHash)
      } else {
        next.add(credentialHash)
      }
      return next
    })
  }

  async function handleBuildPresentation() {
    if (!credentialOwnerAddress) {
      toast.error('Fetch a wallet\'s credentials first.')
      return
    }

    const selected = credentials.filter(
      (cred) => selectedForPresentation.has(cred.credentialHash) && !cred.isBatch
    )

    if (selected.length === 0) {
      toast.error('Select at least one non-batch credential to include.')
      return
    }

    try {
      setBuildingPresentation(true)

      const presentation: Presentation = {
        subject: credentialOwnerAddress,
        createdAt: new Date().toISOString(),
        credentials: selected.map((cred) => ({
          credentialHash: cred.credentialHash,
          ipfsCID: cred.ipfsCID,
          issuer: cred.issuer,
        })),
      }

      const cid = await uploadToIPFS(presentation)
      setPresentationCid(cid)
      toast.success('Presentation created — share the CID below.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to build presentation.')
    } finally {
      setBuildingPresentation(false)
    }
  }

  async function handleLoadPresentation() {
    if (!presentationCidInput.trim()) {
      toast.error('Enter a presentation CID.')
      return
    }

    try {
      setLoadingPresentation(true)
      setPresentationResults(null)

      const res = await fetch(`https://gateway.pinata.cloud/ipfs/${presentationCidInput.trim()}`)
      if (!res.ok) {
        throw new Error('Unable to fetch presentation from IPFS.')
      }

      const presentation = (await res.json()) as Presentation

      const results = await Promise.all(
        presentation.credentials.map(async (entry) => {
          const [valid, issuerTrusted] = await Promise.all([
            readContract(config, {
              ...contractConfig,
              functionName: 'verifyCredential',
              args: [presentation.subject, entry.credentialHash],
            }),
            readContract(config, {
              ...trustRegistryConfig,
              functionName: 'isTrusted',
              args: [entry.issuer],
            }),
          ])

          return {
            ...entry,
            valid: Boolean(valid),
            issuerTrusted: Boolean(issuerTrusted),
          } satisfies PresentationVerifyEntry
        })
      )

      setPresentationResults(results)
    } catch (err) {
      console.error(err)
      toast.error('Failed to load or verify presentation.')
    } finally {
      setLoadingPresentation(false)
    }
  }

  async function authenticateBiometric(index: number) {
    setBiometricLoadingIndex(index)

    try {
      const result = await authenticateWithBiometric(inputAddress || 'sigil-verifier')
      if (!result.ok) {
        toast.error(result.message)
        return false
      }

      return true
    } catch (err) {
      console.error(err)
      toast.error('Biometric authentication failed.')
      return false
    } finally {
      setBiometricLoadingIndex(null)
    }
  }

  // ---------------- SELECTIVE DISCLOSURE ----------------
  async function selectiveDisclosure(index: number) {
    const isAuthenticated = await authenticateBiometric(index)
    if (!isAuthenticated) {
      return
    }

    const cred = credentials[index]
    if (!cred) {
      toast.error('Credential record not found.')
      return
    }
    if (!cred.isValid) {
      toast.error('Cannot disclose data from a revoked credential.')
      return
    }

    try {
      const res = await fetch(
        `https://gateway.pinata.cloud/ipfs/${cred.ipfsCID}`
      )
      if (!res.ok) {
        throw new Error('Unable to fetch credential metadata from IPFS.')
      }

      const json = await res.json()
      const credentialData = json?.credential ?? json

      if (!credentialData || typeof credentialData !== 'object') {
        setDisclosedCredentialIndex(index)
        setDisclosedData({})
        return
      }

      const filteredEntries = Object.entries(credentialData as Record<string, unknown>).filter(
        ([key, value]) => {
          if (!PUBLIC_DISCLOSURE_FIELDS.has(key)) {
            return false
          }
          if (value === null || value === undefined) {
            return false
          }
          return typeof value === 'string' ? value.trim().length > 0 : true
        }
      )

      const dynamicFields: DisclosedData = {}
      filteredEntries.forEach(([key, value]) => {
        dynamicFields[key] = value
      })

      setDisclosedCredentialIndex(index)
      setDisclosedData(dynamicFields)

    } catch (err) {
      console.error(err)
      toast.error('Failed to disclose credential details.')
    }
  }

  // ---------------- ZK AGE VERIFICATION ----------------
  // Proves birthYear+18 <= currentYear via a Groth16 proof (see
  // packages/zk/circuits/AgeOver18.circom), bound to a real credential whose
  // age commitment the ISSUER anchored on-chain at issuance time (see
  // NeuralHashSSI.setAgeCommitment) — not an arbitrary self-reported birth
  // year. AgeVerification.submitAgeProof independently re-checks that the
  // credential is still valid and that the commitment matches before
  // accepting the proof. Proof generation (witness + Groth16 proving) runs
  // entirely client-side via snarkjs's wasm build (see ../zkProve.ts) — the
  // birth year is read from IPFS into this page's memory and never sent to
  // any server.
  async function loadAgeEligibleCredentials() {
    if (!connectedAddress) {
      setAgeEligibleCredentials([])
      return
    }

    try {
      setLoadingAgeEligible(true)

      const ownCredentials = await readContract(config, {
        ...contractConfig,
        functionName: 'getUserCredentials',
        args: [connectedAddress],
      })

      const candidates = (ownCredentials as Credential[]).filter((cred) => cred.isValid && !cred.isBatch)

      const withCommitments = await Promise.all(
        candidates.map(async (cred) => {
          const commitment = await readContract(config, {
            ...contractConfig,
            functionName: 'getAgeCommitment',
            args: [cred.credentialHash],
          })
          return { cred, hasCommitment: (commitment as bigint) !== BigInt(0) }
        })
      )

      const eligible = withCommitments
        .filter((entry) => entry.hasCommitment)
        .map((entry) => ({ credentialHash: entry.cred.credentialHash, ipfsCID: entry.cred.ipfsCID }))

      setAgeEligibleCredentials(eligible)
      if (eligible.length > 0) {
        setSelectedAgeCredential(eligible[0].credentialHash)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoadingAgeEligible(false)
    }
  }

  useEffect(() => {
    void loadAgeEligibleCredentials()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectedAddress])

  async function handleProveAge() {
    if (!connectedAddress) {
      toast.error('Connect a wallet first.')
      return
    }

    if (!selectedAgeCredential) {
      toast.error('No eligible credential selected — issue a credential with a date of birth field first.')
      return
    }

    try {
      setProvingAge(true)
      setProvingAgeStage('fetching')

      const eligible = ageEligibleCredentials.find((c) => c.credentialHash === selectedAgeCredential)
      if (!eligible) {
        throw new Error('Selected credential is no longer eligible.')
      }

      const ipfsRes = await fetch(`https://gateway.pinata.cloud/ipfs/${eligible.ipfsCID}`)
      if (!ipfsRes.ok) {
        throw new Error('Could not fetch credential payload from IPFS.')
      }
      const payload = await ipfsRes.json()
      const zkAgeProof = payload?.zkAgeProof as { birthYear?: number; salt?: string } | undefined

      if (!zkAgeProof?.birthYear || !zkAgeProof?.salt) {
        throw new Error('This credential has no embedded ZK age-proof material.')
      }

      const currentYear = new Date().getFullYear()

      setProvingAgeStage('proving')
      const result = await generateAgeProof(zkAgeProof.birthYear, zkAgeProof.salt, currentYear)
      setProvingAgeStage('submitting')

      const txHash = await writeContractAsync({
        ...ageVerificationConfig,
        functionName: 'submitAgeProof',
        args: [selectedAgeCredential, result.pA, result.pB, result.pC, result.pubSignals],
      })
      await waitForTransactionReceipt(config, { hash: txHash })

      toast.success('Zero-knowledge proof verified on-chain, bound to your credential — age over 18 confirmed, birth date never disclosed.')
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to prove age.')
    } finally {
      setProvingAge(false)
      setProvingAgeStage(null)
    }
  }

  async function handleCheckAgeVerified() {
    if (!ageCheckAddress || !isAddress(ageCheckAddress)) {
      toast.error('Enter a valid wallet address.')
      return
    }

    try {
      setCheckingAge(true)
      const result = await readContract(config, {
        ...ageVerificationConfig,
        functionName: 'isAgeVerified',
        args: [ageCheckAddress as `0x${string}`],
      })
      setAgeVerifiedResult(Boolean(result))
    } catch (err) {
      console.error(err)
      toast.error('Failed to check age-verification status.')
    } finally {
      setCheckingAge(false)
    }
  }

  // ---------------- UI ----------------
  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <main className="space-y-6">
          <div className="flex justify-start">
            <ViewToggle active="verifier" />
          </div>

          <section className=" relative overflow-hidden rounded-xl p-6 sm:p-8">
            <div className="flex items-start justify-between gap-4">
              <p className="nh-chip inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                Sigil Verifier Space
              </p>

              <button
                type="button"
                onClick={() => {
                  disconnect()
                  router.replace('/')
                }}
                className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold shadow-[0_8px_24px_rgba(0,0,0,0.35)] transition"
              >
                Disconnect
              </button>
            </div>

            <div className="max-w-2xl">
              <h2 className="mt-4 text-4xl font-black leading-tight text-violet-50 sm:text-5xl">
                verify with confidence
                <span className="block bg-linear-to-r from-violet-400/25 to-transparent px-2 text-violet-200">
                  <DecryptedText
                    text="without revealing everything"
                    animateOn="view"
                    sequential={true}
                    revealDirection="start"
                    speed={35}
                    className="text-violet-200"
                    encryptedClassName="text-violet-200/45"
                    parentClassName="block"
                  />
                </span>
              </h2>
              <p className="mt-4 text-sm nh-text-muted sm:text-base">
                Check authenticity and selectively disclose only the data you need.
              </p>
            </div>
          </section>

          <section className="nh-panel rounded-lg p-5 sm:p-6">
            <h2 className="text-2xl font-bold text-violet-50 sm:text-3xl">
              Zero-Knowledge Age Verification
            </h2>
            <p className="mt-1 text-sm nh-text-muted">
              Prove you are 18 or older without ever revealing your birth date — a Groth16 proof
              is verified on-chain against a commitment your issuer anchored on a real credential,
              not a self-typed birth year.
            </p>

            <div className="mt-5 grid gap-6 md:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-violet-100/90">Prove your own age</p>

                {loadingAgeEligible && (
                  <p className="mt-2 text-xs text-violet-100/60">Checking your credentials for an anchored age commitment...</p>
                )}

                {!loadingAgeEligible && ageEligibleCredentials.length === 0 && (
                  <p className="mt-2 text-xs text-violet-100/60">
                    No eligible credential found. Ask an issuer to issue you a credential with a
                    date-of-birth field — its age commitment gets anchored automatically.
                  </p>
                )}

                {!loadingAgeEligible && ageEligibleCredentials.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-3">
                    <select
                      className="nh-input w-full flex-1 rounded-xl px-3 py-2 font-mono text-xs"
                      value={selectedAgeCredential}
                      onChange={(e) => setSelectedAgeCredential(e.target.value)}
                    >
                      {ageEligibleCredentials.map((c) => (
                        <option key={c.credentialHash} value={c.credentialHash}>
                          {maskCid(c.credentialHash)}
                        </option>
                      ))}
                    </select>
                    <button
                      className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={handleProveAge}
                      disabled={provingAge}
                    >
                      {provingAgeStage === 'proving'
                        ? 'Generating proof in your browser...'
                        : provingAgeStage === 'submitting'
                          ? 'Submitting to chain...'
                          : provingAgeStage === 'fetching'
                            ? 'Loading credential...'
                            : 'Generate & Submit Proof'}
                    </button>
                  </div>
                )}
                <p className="mt-2 text-xs text-violet-100/60">
                  Only &quot;age &gt;= 18: true/false&quot; is ever recorded on-chain — never the birth year itself.
                  The proof is generated entirely in your browser — your birth date is never sent to any server.
                </p>
              </div>

              <div>
                <p className="text-sm font-semibold text-violet-100/90">Check a wallet&apos;s status</p>
                <div className="mt-2 flex flex-wrap gap-3">
                  <input
                    className="nh-input w-full flex-1 rounded-xl px-3 py-2 font-mono text-sm"
                    placeholder="0x... wallet address"
                    value={ageCheckAddress}
                    onChange={(e) => setAgeCheckAddress(e.target.value)}
                  />
                  <button
                    className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={handleCheckAgeVerified}
                    disabled={checkingAge}
                  >
                    {checkingAge ? 'Checking...' : 'Check'}
                  </button>
                </div>
                {ageVerifiedResult !== null && (
                  <p className={`mt-2 text-sm font-semibold ${ageVerifiedResult ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {ageVerifiedResult ? '✅ Age-verified (18+)' : '❌ Not age-verified'}
                  </p>
                )}
              </div>
            </div>
          </section>

          <section className="nh-panel rounded-lg p-5 sm:p-6">
            <h2 className="text-2xl font-bold text-violet-50 sm:text-3xl">
              Verify a Presentation
            </h2>
            <p className="mt-1 text-sm nh-text-muted">
              Paste a presentation CID a holder shared with you — each credential inside is
              independently re-verified on-chain, not just trusted because it&apos;s in the bundle.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <input
                className="nh-input flex-1 rounded-xl px-3 py-2 font-mono text-sm"
                placeholder="Presentation IPFS CID"
                value={presentationCidInput}
                onChange={(e) => setPresentationCidInput(e.target.value)}
              />
              <button
                className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                onClick={handleLoadPresentation}
                disabled={loadingPresentation}
              >
                {loadingPresentation ? 'Verifying...' : 'Load & Verify'}
              </button>
            </div>

            {presentationResults && (
              <div className="mt-4 space-y-2">
                <p className="text-sm font-semibold text-violet-50">
                  {presentationResults.filter((r) => r.valid).length}/{presentationResults.length} credentials verified
                </p>
                {presentationResults.map((entry) => (
                  <div
                    key={entry.credentialHash}
                    className={`rounded-lg border p-3 text-xs ${
                      entry.valid
                        ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                        : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                    }`}
                  >
                    <p className="font-mono break-all">{entry.credentialHash}</p>
                    <p className="mt-1">
                      {entry.valid ? '✅ Valid on-chain' : '❌ Invalid, revoked, or expired'} ·{' '}
                      {entry.issuerTrusted ? 'Issuer trusted' : 'Issuer not trusted'}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="nh-panel rounded-lg p-5 sm:p-6">
            <h2 className="text-2xl font-bold text-violet-50 sm:text-3xl">
              Public Credential Verification
            </h2>
            <p className="mt-1 text-sm nh-text-muted">
              Lookup wallet credentials, verify integrity, and perform selective disclosure.
            </p>

            <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_auto]">
              <input
                className="nh-input w-full rounded-xl px-3 py-2"
                placeholder="Enter Wallet Address"
                value={inputAddress}
                onChange={(e) => setInputAddress(e.target.value)}
              />

              <button
                className="nh-button-primary rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => fetchCredentials()}
                disabled={loading}
              >
                {loading ? 'Fetching...' : 'Fetch Credentials'}
              </button>
            </div>
          </section>

          <section className="nh-panel rounded-lg p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-2xl font-bold text-violet-50 sm:text-3xl">Received Shared CIDs</h3>
              <button
                type="button"
                className="nh-button-secondary rounded-xl px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                onClick={() => {
                  const trimmedAddress = inputAddress.trim()
                  if (!trimmedAddress || !isAddress(trimmedAddress)) {
                    toast.error('Enter a valid wallet address first.')
                    return
                  }

                  void loadSharedCids(trimmedAddress as `0x${string}`)
                }}
                disabled={sharedCidsLoading}
              >
                {sharedCidsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
            </div>

            <p className="mt-1 text-sm nh-text-muted">
              Parsed from attestations in format <span className="font-mono">selected_cid:&lt;cid&gt;</span>.
            </p>

            {sharedCids.length === 0 && !sharedCidsLoading && (
              <div className="nh-glass mt-5 rounded-lg border border-dashed border-violet-400/35 p-6 text-sm text-violet-100/70">
                No shared CIDs found for this wallet.
              </div>
            )}

            {sharedCids.length > 0 && (
              <div className="mt-5 space-y-3">
                {sharedCids.map((entry, index) => (
                  <article key={`${entry.cid}-${index}`} className="nh-glass rounded-lg border border-violet-400/28 p-4 text-sm text-violet-100/85">
                    <p>
                      <span className="font-semibold text-violet-50">From:</span>{' '}
                      <span className="break-all">{entry.from}</span>
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-violet-50">Timestamp:</span>{' '}
                      {new Date(Number(entry.timestamp) * 1000).toLocaleString()}
                    </p>
                    <p className="mt-1">
                      <span className="font-semibold text-violet-50">CID:</span>{' '}
                      <a
                        href={`https://gateway.pinata.cloud/ipfs/${entry.cid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="break-all text-violet-300 underline decoration-violet-400/70 underline-offset-2 hover:text-violet-200"
                      >
                        {entry.cid}
                      </a>
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>

          <section className="nh-panel rounded-lg p-5 sm:p-6">
            <h3 className="text-2xl font-bold text-violet-50 sm:text-3xl">Credential Records</h3>
            <p className="mt-1 text-sm nh-text-muted">Verify cryptographic integrity before accepting any claim.</p>
            <p className="mt-1 text-xs text-violet-100/70">Selective disclosure requires biometric authentication.</p>

            {credentials.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-violet-300/25 bg-black/15 p-3">
                <p className="text-xs text-violet-100/70">
                  Check &quot;Include in presentation&quot; on one or more credentials below, then bundle them
                  into a single shareable proof-of-set (single credentials only).
                </p>
                <button
                  type="button"
                  onClick={handleBuildPresentation}
                  disabled={buildingPresentation || selectedForPresentation.size === 0}
                  className="nh-button-primary ml-auto shrink-0 rounded-xl px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {buildingPresentation
                    ? 'Building...'
                    : `Build Presentation (${selectedForPresentation.size})`}
                </button>
              </div>
            )}

            {presentationCid && (
              <div className="mt-3 rounded-xl border border-emerald-300/30 bg-emerald-500/10 p-3 text-sm">
                <p className="font-semibold text-emerald-200">Presentation created — share this CID:</p>
                <p className="mt-1 break-all font-mono text-xs text-emerald-100">{presentationCid}</p>
              </div>
            )}

            {credentials.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-violet-100/70">
                <p>
                  Showing {currentPageStart + 1}-{currentPageEnd} of {credentials.length} entries
                </p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setCurrentPage((value) => Math.max(value - 1, 1))}
                    disabled={currentPage === 1}
                    className="nh-button-secondary rounded-xl px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Previous
                  </button>
                  <span>Page {currentPage} of {totalPages}</span>
                  <button
                    type="button"
                    onClick={() => setCurrentPage((value) => Math.min(value + 1, totalPages))}
                    disabled={currentPage === totalPages}
                    className="nh-button-secondary rounded-xl px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}

            {credentials.length === 0 && !loading && (
              <div className="nh-glass mt-5 rounded-lg border border-dashed border-violet-400/35 p-6 text-sm text-violet-100/70">
                No credentials found.
              </div>
            )}

            <div className="mt-5 space-y-4">
              {paginatedCredentials.map((cred, pageIndex) => {
                const index = currentPageStart + pageIndex
                return (
                <article key={`${cred.credentialHash}-${index}`} className="nh-glass rounded-lg border border-violet-400/28 p-5">
                  <div className="space-y-2 text-sm text-violet-100/85">
                    <p>
                      <span className="font-semibold text-violet-50">IPFS CID:</span>{' '}
                      <span className="break-all">{maskCid(cred.ipfsCID)}</span>
                    </p>
                    <p>
                      <span className="font-semibold text-violet-50">Issuer:</span> <span className="break-all">{cred.issuer}</span>
                    </p>
                    <p>
                      <span className="font-semibold text-violet-50">Trust:</span>{' '}
                      <span
                        className={
                          issuerTrustMap[cred.issuer.toLowerCase()]
                            ? 'font-semibold text-emerald-300'
                            : 'font-semibold text-rose-300'
                        }
                      >
                        {issuerTrustMap[cred.issuer.toLowerCase()] ? 'Trusted ✅' : 'Not Trusted ❌'}
                      </span>
                    </p>
                    <p>
                      <span className="font-semibold text-violet-50">Status:</span>{' '}
                      <span className={cred.isValid ? 'font-semibold text-emerald-300' : 'font-semibold text-rose-300'}>
                        {cred.isValid ? 'Active' : 'Revoked'}
                      </span>
                      {cred.isValid && isCredentialExpired(cred) && (
                        <span className="ml-2 font-semibold text-amber-300">(Expired)</span>
                      )}
                    </p>
                    {cred.expiresAt !== BigInt(0) && (
                      <p>
                        <span className="font-semibold text-violet-50">Expires:</span>{' '}
                        {new Date(Number(cred.expiresAt) * 1000).toLocaleString()}
                      </p>
                    )}
                    {cred.isBatch && (
                      <p>
                        <span className="font-semibold text-violet-50">Type:</span>{' '}
                        <span className="font-semibold text-fuchsia-300">Merkle Batch Root</span>
                      </p>
                    )}
                  </div>

                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => (cred.isBatch ? verifyBatchCredential(index) : verifyCredential(index))}
                      disabled={batchVerifying && batchVerificationIndex === index}
                    >
                      {cred.isBatch
                        ? batchVerifying && batchVerificationIndex === index
                          ? 'Verifying Batch...'
                          : 'Verify Batch Inclusion'
                        : 'Verify Integrity'}
                    </button>

                    <button
                      className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold transition"
                      onClick={() => selectiveDisclosure(index)}
                      disabled={biometricLoadingIndex !== null}
                    >
                      {biometricLoadingIndex === index ? 'Authenticating...' : 'Selective Disclosure'}
                    </button>

                    {!cred.isBatch && (
                      <label className="ml-auto flex items-center gap-2 text-sm text-violet-100/80">
                        <input
                          type="checkbox"
                          className="h-4 w-4 accent-violet-400"
                          checked={selectedForPresentation.has(cred.credentialHash)}
                          onChange={() => togglePresentationSelection(cred.credentialHash)}
                        />
                        Include in presentation
                      </label>
                    )}
                  </div>

                  {cred.isBatch && batchVerificationIndex === index && batchVerificationResults && (
                    <div className="mt-4 space-y-2">
                      <p className="text-sm font-semibold text-violet-50">
                        Merkle Inclusion Results ({batchVerificationResults.filter((r) => r.included).length}/{batchVerificationResults.length} verified)
                      </p>
                      {batchVerificationResults.map((entry) => (
                        <div
                          key={entry.leaf}
                          className={`rounded-lg border p-3 text-xs ${
                            entry.included
                              ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-200'
                              : 'border-rose-400/40 bg-rose-500/10 text-rose-200'
                          }`}
                        >
                          <p className="font-mono break-all">{entry.leaf}</p>
                          <p className="mt-1">
                            {entry.included ? '✅ Included in anchored root' : '❌ Not included / proof invalid'}
                          </p>
                          {typeof entry.credential?.name === 'string' && (
                            <p className="mt-1 text-violet-100/70">Name: {String(entry.credential.name)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {disclosedData && disclosedCredentialIndex === index && (
                    <div className="mt-4">
                      <p className="text-lg font-semibold text-violet-50">Selectively Disclosed Information</p>
                      {Object.entries(disclosedData).length === 0 ? (
                        <p className="mt-2 text-sm text-violet-100/75">
                          No public fields are available for disclosure on this credential.
                        </p>
                      ) : (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {Object.entries(disclosedData).map(([key, value]) => (
                            <div key={key} className="nh-glass rounded-lg border border-violet-400/28 p-3 text-md text-violet-100/85">
                              <span className="font-semibold capitalize text-violet-50">{key}:</span>{' '}
                              {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                                ? String(value)
                                : JSON.stringify(value)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )})}
            </div>
          </section>

          {credentialOwnerAddress && (
            <CredentialsSection
              credentials={credentials}
              address={credentialOwnerAddress}
              revokingCredentialHash={null}
              authenticatingCredentialHash={null}
              onRevoke={() => {
              }}
            />
          )}
        </main>
      </div>

      {verificationResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="verification-result-title"
        >
          <section className="nh-panel w-full max-w-lg rounded-lg p-5 sm:p-6">
            <p id="verification-result-title" className="text-2xl font-bold text-violet-50 sm:text-3xl">
              Verification Result
            </p>
            <p className="mt-2 text-lg text-violet-100/85">{verificationResult}</p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold transition"
                onClick={() => setVerificationResult(null)}
              >
                Close
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
