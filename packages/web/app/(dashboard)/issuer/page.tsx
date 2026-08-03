'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useAccount,
  useChainId,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWriteContract,
  useConfig,
} from 'wagmi'
import { waitForTransactionReceipt } from 'wagmi/actions'
import { formatEther, formatGwei, keccak256, parseEther, stringToBytes } from 'viem'
import { MerkleTree } from 'merkletreejs'
import keccak256Lib from 'keccak256'
import { contractConfig } from '../../contract'
import { trustRegistryConfig } from '../../trustRegistry'
import { authenticateWithBiometric } from '../../biometricAuth'
import { uploadFileToIPFS, uploadToIPFS } from '../../ipfs'
import { DashboardHeader } from '../../components/home/DashboardHeader'
import { StatsGrid } from '../../components/home/StatsGrid'
import { IssueCredentialSection } from '../../components/home/IssueCredentialSection'
import { SchemaRegistrySection } from '../../components/home/SchemaRegistrySection'
import { CredentialsSection } from '../../components/home/CredentialsSection'
import { ViewToggle } from '../../components/home/ViewToggle'
import DecryptedText from '../../components/home/DecryptedText'
import type { Credential } from '../../components/home/types'
import { useToast } from '../../components/ui/ToastProvider'
import {
  DOCUMENT_SCHEMAS,
  DOCUMENT_TYPE_OPTIONS,
  normalizeDocumentType,
  type SupportedDocumentType,
} from '../../documentSchemas'

type IssuanceTxDetails = {
  hash: `0x${string}`
  blockNumber: bigint
  confirmations: bigint
  blockHash: `0x${string}`
  timestamp: bigint
  gasUsed: bigint
  effectiveGasPrice: bigint
  ethSpent: bigint
  usdEquivalent?: number
}

// Best-effort birth-year extraction from whatever date format OCR/manual
// entry produced (YYYY-MM-DD, DD/MM/YYYY, "12 May 1990", etc.) — used only
// to anchor a ZK age-predicate commitment at issuance time.
function parseBirthYear(dateString: string): number | null {
  const currentYear = new Date().getFullYear()

  const parsed = new Date(dateString)
  if (!Number.isNaN(parsed.getTime())) {
    const year = parsed.getFullYear()
    if (year >= 1900 && year <= currentYear) {
      return year
    }
  }

  const match = dateString.match(/(19|20)\d{2}/)
  if (match) {
    const year = Number(match[0])
    if (year >= 1900 && year <= currentYear) {
      return year
    }
  }

  return null
}

function generateZkSalt(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let hex = '0x'
  bytes.forEach((byte) => {
    hex += byte.toString(16).padStart(2, '0')
  })
  return BigInt(hex).toString()
}

export default function IssuerPage() {
  const { address } = useAccount()
  const chainId = useChainId()
  const { disconnect } = useDisconnect()
  const router = useRouter()
  const config = useConfig()
  const publicClient = usePublicClient()
  const toast = useToast()

  useEffect(() => {
    if (!address) {
      router.replace('/')
    }
  }, [address, router])

  const { data, refetch } = useReadContract({
    ...contractConfig,
    functionName: 'getUserCredentials',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  })

  const { data: trustStatus, isLoading: trustLoading } = useReadContract({
    ...trustRegistryConfig,
    functionName: 'isTrusted',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  })

  const { data: minimumStake } = useReadContract({
    ...trustRegistryConfig,
    functionName: 'minimumStake',
  })

  const { data: stakedAmount, refetch: refetchStake } = useReadContract({
    ...trustRegistryConfig,
    functionName: 'stakedAmount',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  })

  const { data: registryOwner } = useReadContract({
    ...trustRegistryConfig,
    functionName: 'owner',
  })

  const isRegistryOwner = Boolean(
    address && registryOwner && (registryOwner as string).toLowerCase() === address.toLowerCase()
  )

  const { writeContractAsync } = useWriteContract()

  const [selectedDocumentType, setSelectedDocumentType] = useState<SupportedDocumentType>('10th Marksheet')
  const [extractedFields, setExtractedFields] = useState<Record<string, string>>({})
  const [selectedFieldKeys, setSelectedFieldKeys] = useState<string[]>([])
  const [recipient, setRecipient] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [expiryDate, setExpiryDate] = useState('')
  const [stakeInput, setStakeInput] = useState('')
  const [staking, setStaking] = useState(false)
  const [loading, setLoading] = useState(false)
  const [revokingCredentialHash, setRevokingCredentialHash] = useState<`0x${string}` | null>(null)
  const [authenticatingIssue, setAuthenticatingIssue] = useState(false)
  const [authenticatingRevokeHash, setAuthenticatingRevokeHash] = useState<`0x${string}` | null>(null)
  const [latestIssuanceTx, setLatestIssuanceTx] = useState<IssuanceTxDetails | null>(null)
  const [batchMode, setBatchMode] = useState(false)
  const [batchCredentials, setBatchCredentials] = useState<Record<string, unknown>[]>([])

  const [admitAddressInput, setAdmitAddressInput] = useState('')
  const [admitNameInput, setAdmitNameInput] = useState('')
  const [admitting, setAdmitting] = useState(false)
  const [revokeTrustAddressInput, setRevokeTrustAddressInput] = useState('')
  const [revokingTrust, setRevokingTrust] = useState(false)
  const [slashAddressInput, setSlashAddressInput] = useState('')
  const [slashAmountInput, setSlashAmountInput] = useState('')
  const [slashing, setSlashing] = useState(false)

  const credentials = (data ?? []) as Credential[]
  const activeCredentials = credentials.filter((cred) => cred.isValid).length
  const revokedCredentials = credentials.length - activeCredentials

  async function setLatestIssuanceFromTx(txHash: `0x${string}`) {
    const receipt = await waitForTransactionReceipt(config, { hash: txHash })

    const currentBlockNumber = publicClient
      ? await publicClient.getBlockNumber()
      : receipt.blockNumber
    const block = publicClient
      ? await publicClient.getBlock({ blockNumber: receipt.blockNumber })
      : null

    const effectiveGasPrice = receipt.effectiveGasPrice ?? BigInt(0)
    const gasUsed = receipt.gasUsed
    const ethSpent = gasUsed * effectiveGasPrice
    const confirmations =
      currentBlockNumber >= receipt.blockNumber
        ? currentBlockNumber - receipt.blockNumber + BigInt(1)
        : BigInt(1)

    setLatestIssuanceTx({
      hash: txHash,
      blockNumber: receipt.blockNumber,
      confirmations,
      blockHash: receipt.blockHash,
      timestamp: block?.timestamp ?? BigInt(Math.floor(Date.now() / 1000)),
      gasUsed,
      effectiveGasPrice,
      ethSpent,
    })
  }

  async function handleDepositStake() {
    if (!stakeInput || Number(stakeInput) <= 0) {
      toast.error('Enter an amount of ETH to stake.')
      return
    }

    try {
      setStaking(true)
      const txHash = await writeContractAsync({
        ...trustRegistryConfig,
        functionName: 'depositStake',
        value: parseEther(stakeInput),
      })
      await waitForTransactionReceipt(config, { hash: txHash })
      await refetchStake()
      toast.success('Stake deposited. Ask the registry owner to mark you trusted once you meet the minimum.')
      setStakeInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to deposit stake.')
    } finally {
      setStaking(false)
    }
  }

  // Registry-owner-only admin actions. Previously only reachable via a
  // Hardhat script (deploy-all.js / the Hardhat console) — surfaced here so
  // issuer admission and slashing are demonstrable from the app itself, not
  // just from tooling.
  async function handleAdmitIssuer() {
    if (!admitAddressInput.startsWith('0x')) {
      toast.error('Enter a valid issuer wallet address.')
      return
    }

    try {
      setAdmitting(true)
      const hash = await writeContractAsync({
        ...trustRegistryConfig,
        functionName: 'setIssuer',
        args: [admitAddressInput as `0x${string}`, admitNameInput || '', '', true],
      })
      await waitForTransactionReceipt(config, { hash })
      toast.success('Issuer marked trusted.')
      setAdmitAddressInput('')
      setAdmitNameInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to admit issuer — they must have staked at least the minimum first.')
    } finally {
      setAdmitting(false)
    }
  }

  async function handleRevokeTrust() {
    if (!revokeTrustAddressInput.startsWith('0x')) {
      toast.error('Enter a valid issuer wallet address.')
      return
    }

    try {
      setRevokingTrust(true)
      const hash = await writeContractAsync({
        ...trustRegistryConfig,
        functionName: 'setIssuer',
        args: [revokeTrustAddressInput as `0x${string}`, '', '', false],
      })
      await waitForTransactionReceipt(config, { hash })
      toast.success('Issuer trust revoked.')
      setRevokeTrustAddressInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to revoke trust.')
    } finally {
      setRevokingTrust(false)
    }
  }

  async function handleSlashIssuer() {
    if (!slashAddressInput.startsWith('0x')) {
      toast.error('Enter a valid issuer wallet address.')
      return
    }
    if (!slashAmountInput || Number(slashAmountInput) <= 0) {
      toast.error('Enter an amount of ETH to slash.')
      return
    }

    try {
      setSlashing(true)
      const hash = await writeContractAsync({
        ...trustRegistryConfig,
        functionName: 'slash',
        args: [slashAddressInput as `0x${string}`, parseEther(slashAmountInput)],
      })
      await waitForTransactionReceipt(config, { hash })
      toast.success('Issuer slashed — stake forwarded to the registry owner, trust revoked.')
      setSlashAddressInput('')
      setSlashAmountInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to slash — amount may exceed the issuer\'s current stake.')
    } finally {
      setSlashing(false)
    }
  }

  async function handleExtract() {
    if (!file) {
      toast.info('Upload a PDF first')
      return
    }

    try {
      setLoading(true)

      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch('/api/extract', {
        method: 'POST',
        body: formData,
      })

      const result = await res.json()

      if (res.status === 429 || result.code === 'QUOTA_EXCEEDED') {
        toast.error(result.error ?? 'Gemini quota exceeded. Please retry later.')
        return
      }

      if (!res.ok || result.error) {
        throw new Error(result.error ?? 'Extraction failed')
      }

      if (!result.data) {
        toast.error('Extraction failed')
        return
      }

      const extractedType = normalizeDocumentType(result.data.documentType ?? '')

      if (!extractedType) {
        toast.error('Could not identify document type from uploaded file.')
        setExtractedFields({})
        return
      }

      if (extractedType !== selectedDocumentType) {
        toast.error(`Wrong document uploaded. You selected ${selectedDocumentType}, but detected ${extractedType}.`)
        setExtractedFields({})
        return
      }

      const schemaFields = DOCUMENT_SCHEMAS[selectedDocumentType]
      const incomingFields = (result.data.fields ?? {}) as Record<string, string>

      const mappedFields = schemaFields.reduce<Record<string, string>>((acc, fieldKey) => {
        const value = incomingFields[fieldKey]
        acc[fieldKey] = typeof value === 'string' ? value : ''
        return acc
      }, {})

      setExtractedFields(mappedFields)
      setSelectedFieldKeys(
        schemaFields.filter((fieldKey) => Boolean(mappedFields[fieldKey]?.trim()))
      )

      toast.success('Data extracted successfully!')
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Extraction error')
    } finally {
      setLoading(false)
    }
  }

  async function handleIssue() {
    if (!address || loading || authenticatingIssue || Boolean(authenticatingRevokeHash) || Boolean(revokingCredentialHash)) {
      return
    }

    setAuthenticatingIssue(true)
    const biometricResult = await authenticateWithBiometric(address)
    setAuthenticatingIssue(false)

    if (!biometricResult.ok) {
      toast.error(biometricResult.message)
      return
    }

    const targetAddress =
      recipient && recipient.startsWith('0x')
        ? recipient
        : address

    const selectedFields = selectedFieldKeys.reduce<Record<string, string>>((acc, fieldKey) => {
      const value = extractedFields[fieldKey]?.trim()
      if (value) {
        acc[fieldKey] = value
      }
      return acc
    }, {})

    const name =
      selectedFields.full_name ||
      selectedFields.student_name ||
      ''
    const type = selectedDocumentType
    const year =
      selectedFields.year_of_passing ||
      selectedFields.date_of_birth ||
      ''

    if (expiryDate && new Date(expiryDate).getTime() <= Date.now()) {
      toast.error('Expiry date must be in the future.')
      return
    }
    const expiresAt = expiryDate
      ? BigInt(Math.floor(new Date(expiryDate).getTime() / 1000))
      : BigInt(0)

    try {
      setLoading(true)

      let documentCid: string | undefined
      if (file) {
        documentCid = await uploadFileToIPFS(file)
      }

      // If this credential carries a date of birth, generate a ZK-proof salt
      // now and embed it in the same JSON that gets hashed on-chain — so the
      // holder can later recover {birthYear, salt} from their own credential
      // to prove age without ever having self-reported the birth year.
      const birthYear = selectedFields.date_of_birth
        ? parseBirthYear(selectedFields.date_of_birth)
        : null
      const zkAgeSalt = birthYear ? generateZkSalt() : null

      const credential = {
        name,
        type,
        year,
        issuedTo: targetAddress,
        timestamp: new Date().toISOString(),
        documentCid,
        selectedFields,
        ...(birthYear && zkAgeSalt ? { zkAgeProof: { birthYear, salt: zkAgeSalt } } : {}),
      }

      if (!batchMode) {
        const cid = await uploadToIPFS(credential)

        const hashValue = keccak256(
          stringToBytes(JSON.stringify(credential))
        )

        const txHash = await writeContractAsync({
          ...contractConfig,
          functionName: 'issueCredential',
          args: [targetAddress as `0x${string}`, hashValue, cid, expiresAt],
        })

        await setLatestIssuanceFromTx(txHash)
        await refetch()

        if (birthYear && zkAgeSalt) {
          try {
            const commitmentRes = await fetch('/api/zk/commitment', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ birthYear, salt: zkAgeSalt }),
            })
            const commitmentResult = await commitmentRes.json()

            if (commitmentRes.ok && commitmentResult.commitment) {
              const commitmentTxHash = await writeContractAsync({
                ...contractConfig,
                functionName: 'setAgeCommitment',
                args: [targetAddress as `0x${string}`, hashValue, BigInt(commitmentResult.commitment)],
              })
              await waitForTransactionReceipt(config, { hash: commitmentTxHash })
              toast.success('Age commitment anchored — this credential can now back a ZK age-over-18 proof.')
            } else {
              toast.info('Credential issued, but anchoring its ZK age commitment failed — age proofs won’t be available for it.')
            }
          } catch (err) {
            console.error(err)
            toast.info('Credential issued, but anchoring its ZK age commitment failed — age proofs won’t be available for it.')
          }
        }

        alert('Single Credential Issued')
        return
      }

      const updatedBatch = [...batchCredentials, credential]
      setBatchCredentials(updatedBatch)

      const leaves = updatedBatch.map((c) =>
        keccak256Lib(JSON.stringify(c))
      )

      const tree = new MerkleTree(leaves, keccak256Lib, {
        sortPairs: true,
      })

      const root = tree.getHexRoot()

      const batchWithProofs = updatedBatch.map((c, i) => {
        const leaf = leaves[i]
        const proof = tree.getHexProof(leaf)

        return {
          credential: c,
          leaf: '0x' + leaf.toString('hex'),
          proof,
        }
      })

      const batchPayload = {
        root,
        credentials: batchWithProofs,
      }

      const batchCID = await uploadToIPFS(batchPayload)

      const txHash = await writeContractAsync({
        ...contractConfig,
        functionName: 'issueBatchCredential',
        args: [targetAddress as `0x${string}`, root as `0x${string}`, batchCID, expiresAt],
      })

      await setLatestIssuanceFromTx(txHash)
      await refetch()

      alert('Merkle Batch Root Anchored On-Chain')
    } finally {
      setLoading(false)
    }
  }

  async function handleRevoke(credentialHash: `0x${string}`) {
    if (
      !address ||
      loading ||
      authenticatingIssue ||
      Boolean(authenticatingRevokeHash) ||
      Boolean(revokingCredentialHash)
    ) {
      return
    }

    setAuthenticatingRevokeHash(credentialHash)
    const biometricResult = await authenticateWithBiometric(address)
    setAuthenticatingRevokeHash(null)

    if (!biometricResult.ok) {
      toast.error(biometricResult.message)
      return
    }

    try {
      setRevokingCredentialHash(credentialHash)

      const txHash = await writeContractAsync({
        ...contractConfig,
        functionName: 'revokeCredential',
        args: [address, credentialHash],
      })

      await waitForTransactionReceipt(config, { hash: txHash })

      await refetch()
      toast.success('Credential Revoked Successfully')
    } catch (err) {
      console.error(err)
      toast.error('Revoke Failed')
    } finally {
      setRevokingCredentialHash(null)
      setAuthenticatingRevokeHash(null)
    }
  }

  if (!address) {
    return null
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <main className="space-y-6">
          <div className="flex justify-start">
            <ViewToggle active="issuer" />
          </div>

          <DashboardHeader chainId={chainId} />

          <section className="px-6 sm:px-6">
            <p className="inline-flex items-center gap-2 text-sm text-violet-100/80 sm:text-base">
              <span>Current user status:</span>
              {trustLoading ? (
                <span className="font-semibold text-violet-100">Checking...</span>
              ) : trustStatus ? (
                <span className="font-extrabold text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.65)]">
                  Trusted
                </span>
              ) : (
                <span className="font-semibold text-rose-300">Not Trusted</span>
              )}
            </p>
          </section>

          {!trustStatus && !trustLoading && (
            <section className="nh-panel mx-6 rounded-md p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-violet-50">Become a Trusted Issuer</h3>
              <p className="mt-1 text-sm nh-text-muted">
                Trust now requires real collateral, not just an admin decision: stake at least the
                minimum below, then ask the registry owner to mark your address trusted. If
                you&apos;re later found to have issued a fraudulent credential, this stake can be slashed.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Minimum Stake</p>
                  <p className="mt-1 font-mono text-violet-50">
                    {minimumStake !== undefined ? `${formatEther(minimumStake as bigint)} ETH` : '—'}
                  </p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Your Current Stake</p>
                  <p className="mt-1 font-mono text-violet-50">
                    {stakedAmount !== undefined ? `${formatEther(stakedAmount as bigint)} ETH` : '—'}
                  </p>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap gap-3">
                <input
                  className="nh-input flex-1 rounded-xl px-3 py-2.5 text-sm"
                  type="number"
                  step="0.001"
                  min="0"
                  placeholder="Amount to stake (ETH)"
                  value={stakeInput}
                  onChange={(e) => setStakeInput(e.target.value)}
                />
                <button
                  type="button"
                  onClick={handleDepositStake}
                  disabled={staking}
                  className="nh-button-primary rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {staking ? 'Staking...' : 'Deposit Stake'}
                </button>
              </div>
            </section>
          )}

          {isRegistryOwner && (
            <section className="nh-panel mx-6 rounded-md p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-violet-50">Registry Admin</h3>
              <p className="mt-1 text-sm nh-text-muted">
                You are the TrustRegistry owner. Admit an issuer once they&apos;ve staked the
                minimum, revoke trust, or slash a misbehaving issuer&apos;s stake — the on-chain
                accountability mechanism this project&apos;s trust model relies on.
              </p>

              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div>
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Admit Issuer</p>
                  <div className="mt-2 space-y-2">
                    <input
                      className="nh-input w-full rounded-xl px-3 py-2.5 font-mono text-sm"
                      placeholder="0x... issuer address"
                      value={admitAddressInput}
                      onChange={(e) => setAdmitAddressInput(e.target.value)}
                    />
                    <input
                      className="nh-input w-full rounded-xl px-3 py-2.5 text-sm"
                      placeholder="Display name"
                      value={admitNameInput}
                      onChange={(e) => setAdmitNameInput(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleAdmitIssuer}
                      disabled={admitting}
                      className="nh-button-primary w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {admitting ? 'Admitting...' : 'Mark Trusted'}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Revoke Trust</p>
                  <div className="mt-2 space-y-2">
                    <input
                      className="nh-input w-full rounded-xl px-3 py-2.5 font-mono text-sm"
                      placeholder="0x... issuer address"
                      value={revokeTrustAddressInput}
                      onChange={(e) => setRevokeTrustAddressInput(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleRevokeTrust}
                      disabled={revokingTrust}
                      className="nh-button-secondary w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {revokingTrust ? 'Revoking...' : 'Revoke Trust'}
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Slash Stake</p>
                  <div className="mt-2 space-y-2">
                    <input
                      className="nh-input w-full rounded-xl px-3 py-2.5 font-mono text-sm"
                      placeholder="0x... issuer address"
                      value={slashAddressInput}
                      onChange={(e) => setSlashAddressInput(e.target.value)}
                    />
                    <input
                      className="nh-input w-full rounded-xl px-3 py-2.5 text-sm"
                      type="number"
                      step="0.001"
                      min="0"
                      placeholder="Amount to slash (ETH)"
                      value={slashAmountInput}
                      onChange={(e) => setSlashAmountInput(e.target.value)}
                    />
                    <button
                      type="button"
                      onClick={handleSlashIssuer}
                      disabled={slashing}
                      className="nh-button-secondary w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {slashing ? 'Slashing...' : 'Slash Issuer'}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          )}

          <section className=" relative overflow-hidden rounded-md px-6 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
            <div className="flex items-start justify-between gap-4">
              <p className="nh-chip inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                Sigil Issuer Space
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
                the credential hub
                <span className="block bg-linear-to-r from-violet-400/25 to-transparent px-2 text-violet-200">
                  <DecryptedText
                    text="for modern SSI workflows"
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
                Keep issuing, revoking, and sharing verifiable credentials with a clean dashboard flow.
              </p>
            </div>
          </section>

          <SchemaRegistrySection />

          <div className="mt-6 mb-4">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={batchMode}
                onChange={() => setBatchMode(!batchMode)}
              />
              Enable Merkle Batch Mode
            </label>
          </div>

          <section className="grid gap-6 lg:grid-cols-[minmax(0,4.2fr)_minmax(200px,1fr)]">
            <IssueCredentialSection
              selectedDocumentType={selectedDocumentType}
              documentTypeOptions={DOCUMENT_TYPE_OPTIONS}
              fieldKeys={[...DOCUMENT_SCHEMAS[selectedDocumentType]]}
              extractedFields={extractedFields}
              selectedFieldKeys={selectedFieldKeys}
              recipient={recipient}
              file={file}
              expiryDate={expiryDate}
              loading={loading}
              authenticating={authenticatingIssue}
              onExpiryDateChange={setExpiryDate}
              onDocumentTypeChange={(nextType) => {
                setSelectedDocumentType(nextType)
                setExtractedFields({})
                setSelectedFieldKeys([])
              }}
              onFieldSelectionChange={(fieldKey, checked) => {
                setSelectedFieldKeys((prev) => {
                  if (checked) {
                    if (prev.includes(fieldKey)) {
                      return prev
                    }

                    return [...prev, fieldKey]
                  }

                  return prev.filter((key) => key !== fieldKey)
                })
              }}
              onRecipientChange={setRecipient}
              onFileChange={setFile}
              onExtract={handleExtract}
              onIssue={handleIssue}
            />

            <StatsGrid
              walletConnected={Boolean(address)}
              totalCredentials={credentials.length}
              activeCredentials={activeCredentials}
              revokedCredentials={revokedCredentials}
              layout="stack"
            />
          </section>

          <section className="nh-panel rounded-md p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-violet-50">Latest Issuance Transaction</h3>
            {!latestIssuanceTx ? (
              <p className="mt-2 text-sm nh-text-muted">
                Issue a credential to view block number, gas usage, confirmations, timestamp, and block hash.
              </p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Block Number</p>
                  <p className="mt-1 font-mono text-violet-50">{latestIssuanceTx.blockNumber.toString()}</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Transaction Confirmations</p>
                  <p className="mt-1 font-mono text-violet-50">{latestIssuanceTx.confirmations.toString()}</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Timestamp</p>
                  <p className="mt-1 font-mono text-violet-50">{new Date(Number(latestIssuanceTx.timestamp) * 1000).toLocaleString()}</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm sm:col-span-2 lg:col-span-3">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Block Hash</p>
                  <p className="mt-1 truncate font-mono text-violet-50">{latestIssuanceTx.blockHash}</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Gas Used</p>
                  <p className="mt-1 font-mono text-violet-50">{latestIssuanceTx.gasUsed.toString()}</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Gas Price</p>
                  <p className="mt-1 font-mono text-violet-50">{formatGwei(latestIssuanceTx.effectiveGasPrice)} Gwei</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">ETH Spent</p>
                  <p className="mt-1 font-mono text-violet-50">{Number(formatEther(latestIssuanceTx.ethSpent)).toFixed(8)} ETH</p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">USD Equivalent</p>
                  <p className="mt-1 font-mono text-violet-50">
                    {typeof latestIssuanceTx.usdEquivalent === 'number'
                      ? `$${latestIssuanceTx.usdEquivalent.toFixed(2)}`
                      : 'Unavailable'}
                  </p>
                </div>
                <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm sm:col-span-2">
                  <p className="text-xs uppercase tracking-wide text-violet-100/70">Transaction Hash</p>
                  <p className="mt-1 truncate font-mono text-violet-50">{latestIssuanceTx.hash}</p>
                  <a
                    href={`https://sepolia.etherscan.io/tx/${latestIssuanceTx.hash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-sm font-semibold text-violet-300 underline decoration-violet-400/70 underline-offset-2 hover:text-violet-200"
                  >
                    View on Etherscan
                  </a>
                </div>
              </div>
            )}
          </section>

          <CredentialsSection
            credentials={credentials}
            address={address}
            revokingCredentialHash={revokingCredentialHash}
            authenticatingCredentialHash={authenticatingRevokeHash}
            onRevoke={handleRevoke}
          />
      </main>
    </div>
  )
}
