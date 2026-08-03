'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useAccount,
  useChainId,
  useDisconnect,
  useReadContract,
  useWriteContract,
  useConfig,
} from 'wagmi'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { isAddress } from 'viem'
import { contractConfig } from '../../contract'
import { interactionHubConfig } from '../../interactionHub'
import { DashboardHeader } from '../../components/home/DashboardHeader'
import { ViewToggle } from '../../components/home/ViewToggle'
import DecryptedText from '../../components/home/DecryptedText'
import { useToast } from '../../components/ui/ToastProvider'
import type { Credential } from '../../components/home/types'

type ClaimRequestTuple = readonly [
  bigint,
  `0x${string}`,
  `0x${string}`,
  string,
  boolean,
  bigint,
]

type AttestationTuple = readonly [
  `0x${string}`,
  `0x${string}`,
  string,
  bigint,
]

type AttestationObject = {
  attester?: `0x${string}`
  statement?: string
}

type CredentialPreviewMeta = {
  title: string
  type?: string
}

function isAttestationTuple(value: AttestationTuple | AttestationObject): value is AttestationTuple {
  return Array.isArray(value)
}

export default function InteractionsPage() {
  const { address } = useAccount()
  const chainId = useChainId()
  const { disconnect } = useDisconnect()
  const router = useRouter()
  const config = useConfig()
  const toast = useToast()

  const { data: requestIds } = useReadContract({
    ...interactionHubConfig,
    functionName: 'getRequestsForUser',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  })

  const { data: attestations } = useReadContract({
    ...interactionHubConfig,
    functionName: 'getAttestations',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  })

  const { data: credentialData } = useReadContract({
    ...contractConfig,
    functionName: 'getUserCredentials',
    args: address ? [address] : undefined,
    query: {
      enabled: Boolean(address),
    },
  })

  const { writeContractAsync } = useWriteContract()

  const [hubTargetAddress, setHubTargetAddress] = useState('')
  const [claimReason, setClaimReason] = useState('')
  const [attestationText, setAttestationText] = useState('')
  const [claimLoading, setClaimLoading] = useState(false)
  const [attestationLoading, setAttestationLoading] = useState(false)
  const [acceptingRequestId, setAcceptingRequestId] = useState<bigint | null>(null)
  const [requests, setRequests] = useState<ClaimRequestTuple[]>([])
  const [fulfillModalOpen, setFulfillModalOpen] = useState(false)
  const [pendingFulfillRequest, setPendingFulfillRequest] = useState<ClaimRequestTuple | null>(null)
  const [selectedCredentialCid, setSelectedCredentialCid] = useState<string>('')
  const [credentialMetaMap, setCredentialMetaMap] = useState<Record<string, CredentialPreviewMeta>>({})
  const [credentialMetaLoading, setCredentialMetaLoading] = useState(false)

  const credentials = (credentialData ?? []) as Credential[]
  const validCredentials = credentials.filter((credential) => credential.isValid)

  useEffect(() => {
    if (!address) {
      router.replace('/')
    }
  }, [address, router])

  useEffect(() => {
    async function loadRequests() {
      if (!requestIds || !Array.isArray(requestIds) || requestIds.length === 0) {
        setRequests([])
        return
      }

      const results = await Promise.all(
        requestIds.map((id) =>
          readContract(config, {
            ...interactionHubConfig,
            functionName: 'claimRequests',
            args: [id],
          })
        )
      )

      setRequests(results as ClaimRequestTuple[])
    }

    void loadRequests()
  }, [config, requestIds])

  useEffect(() => {
    async function hydrateCredentialMeta() {
      if (!fulfillModalOpen || validCredentials.length === 0) {
        return
      }

      const missingCids = validCredentials
        .map((credential) => credential.ipfsCID)
        .filter((cid) => !credentialMetaMap[cid])

      if (missingCids.length === 0) {
        return
      }

      setCredentialMetaLoading(true)

      try {
        const resolvedEntries = await Promise.all(
          missingCids.map(async (cid) => {
            const gateways = [
              `https://gateway.pinata.cloud/ipfs/${cid}`,
              `https://ipfs.io/ipfs/${cid}`,
            ]

            let payload: Record<string, unknown> | null = null

            for (const gatewayUrl of gateways) {
              try {
                const response = await fetch(gatewayUrl, { cache: 'no-store' })
                if (!response.ok) {
                  continue
                }

                const parsed = await response.json().catch(() => null)
                if (parsed && typeof parsed === 'object') {
                  payload = parsed as Record<string, unknown>
                  break
                }
              } catch {
              }
            }

            const titleFromDocumentName =
              typeof payload?.documentName === 'string' && payload.documentName.trim().length > 0
                ? payload.documentName
                : null

            const titleFromName =
              typeof payload?.name === 'string' && payload.name.trim().length > 0
                ? payload.name
                : null

            const type =
              typeof payload?.type === 'string' && payload.type.trim().length > 0
                ? payload.type
                : typeof payload?.documentType === 'string' && payload.documentType.trim().length > 0
                  ? payload.documentType
                  : undefined

            const title = titleFromDocumentName || titleFromName || 'Unnamed Credential'

            return [cid, { title, type } satisfies CredentialPreviewMeta] as const
          })
        )

        setCredentialMetaMap((prev) => ({
          ...prev,
          ...Object.fromEntries(resolvedEntries),
        }))
      } finally {
        setCredentialMetaLoading(false)
      }
    }

    void hydrateCredentialMeta()
  }, [fulfillModalOpen, validCredentials, credentialMetaMap])

  async function handleClaimRequest() {
    if (!address) {
      return
    }

    if (!hubTargetAddress || !isAddress(hubTargetAddress)) {
      toast.error('Enter a valid target wallet address for claim request.')
      return
    }

    if (!claimReason.trim()) {
      toast.info('Enter a claim reason first.')
      return
    }

    try {
      setClaimLoading(true)

      const txHash = await writeContractAsync({
        ...interactionHubConfig,
        functionName: 'createClaimRequest',
        args: [
          hubTargetAddress as `0x${string}`,
          ['type', 'year'],
          claimReason,
        ],
      })

      await waitForTransactionReceipt(config, { hash: txHash })
      toast.success('Claim Request Sent')
      setClaimReason('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to send claim request')
    } finally {
      setClaimLoading(false)
    }
  }

  async function handleAttestation() {
    if (!address) {
      return
    }

    if (!hubTargetAddress || !isAddress(hubTargetAddress)) {
      toast.error('Enter a valid target wallet address for attestation.')
      return
    }

    if (!attestationText.trim()) {
      toast.info('Enter attestation text first.')
      return
    }

    try {
      setAttestationLoading(true)

      const txHash = await writeContractAsync({
        ...interactionHubConfig,
        functionName: 'createAttestation',
        args: [
          hubTargetAddress as `0x${string}`,
          attestationText,
        ],
      })

      await waitForTransactionReceipt(config, { hash: txHash })
      toast.success('Attestation Created')
      setAttestationText('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to create attestation')
    } finally {
      setAttestationLoading(false)
    }
  }

  function openFulfillModal(request: ClaimRequestTuple) {
    if (validCredentials.length === 0) {
      toast.error('No active credentials available to share.')
      return
    }

    setPendingFulfillRequest(request)
    setSelectedCredentialCid(validCredentials[0]?.ipfsCID ?? '')
    setFulfillModalOpen(true)
  }

  function closeFulfillModal() {
    setFulfillModalOpen(false)
    setPendingFulfillRequest(null)
    setSelectedCredentialCid('')
  }

  async function handleAcceptRequest() {
    if (!address) {
      return
    }

    if (!pendingFulfillRequest) {
      toast.error('No pending claim request selected.')
      return
    }

    if (!selectedCredentialCid) {
      toast.info('Select a credential before fulfilling claim request.')
      return
    }

    const requestId = pendingFulfillRequest[0]
    const requesterAddress = pendingFulfillRequest[1]

    try {
      setAcceptingRequestId(requestId)

      const txHash = await writeContractAsync({
        ...interactionHubConfig,
        functionName: 'fulfillClaimRequest',
        args: [requestId],
      })

      await waitForTransactionReceipt(config, { hash: txHash })

      setRequests((prev) =>
        prev.map((request) =>
          request[0] === requestId
            ? [request[0], request[1], request[2], request[3], true, request[5]]
            : request
        ) as ClaimRequestTuple[]
      )

      try {
        const cidTxHash = await writeContractAsync({
          ...interactionHubConfig,
          functionName: 'createAttestation',
          args: [requesterAddress, `selected_cid:${selectedCredentialCid}`],
        })

        await waitForTransactionReceipt(config, { hash: cidTxHash })
      } catch (attestationError) {
        console.error(attestationError)
        toast.info(`Claim fulfilled, but requester notification failed. Selected CID: ${selectedCredentialCid}`)
        closeFulfillModal()
        return
      }

      toast.success(`Claim fulfilled. Selected CID shared: ${selectedCredentialCid}`)
      closeFulfillModal()
    } catch (err) {
      console.error(err)
      toast.error('Failed to accept request')
    } finally {
      setAcceptingRequestId(null)
    }
  }

  if (!address) {
    return null
  }

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <main className="space-y-6">
          <div className="flex justify-start">
            <ViewToggle active="interactions" />
          </div>

          <DashboardHeader chainId={chainId} />

          <section className="relative overflow-hidden rounded-md px-6 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
            <div className="flex items-start justify-between gap-4">
              <p className="nh-chip inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                Sigil Interactions Space
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
                interaction portal
                <span className="block bg-linear-to-r from-violet-400/25 to-transparent px-2 text-violet-200">
                  <DecryptedText
                    text="claims and attestations"
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
            </div>
          </section>

          <section className="nh-panel rounded-md p-5 sm:p-6">
            <h3 className="text-lg font-semibold text-violet-50">Interaction Hub</h3>
            <p className="mt-1 text-sm nh-text-muted">
              Create claim requests and attestations for a target wallet.
            </p>

            <div className="mt-5 space-y-3">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem]">
                <input
                  className="nh-input w-full rounded-xl px-3 py-2.5 font-mono text-sm"
                  placeholder="Target Wallet Address"
                  value={hubTargetAddress}
                  onChange={(event) => setHubTargetAddress(event.target.value)}
                />
                <div className="hidden md:block" />
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem]">
                <input
                  className="nh-input w-full rounded-xl px-3 py-2.5 text-sm"
                  placeholder="Claim Reason"
                  value={claimReason}
                  onChange={(event) => setClaimReason(event.target.value)}
                />
                <button
                  type="button"
                  className="nh-button-secondary w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleClaimRequest}
                  disabled={claimLoading || attestationLoading}
                >
                  {claimLoading ? 'Sending...' : 'Send Claim Request'}
                </button>
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_11rem]">
                <input
                  className="nh-input w-full rounded-xl px-3 py-2.5 text-sm"
                  placeholder="Attestation Text"
                  value={attestationText}
                  onChange={(event) => setAttestationText(event.target.value)}
                />
                <button
                  type="button"
                  className="nh-button-secondary w-full rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={handleAttestation}
                  disabled={claimLoading || attestationLoading}
                >
                  {attestationLoading ? 'Submitting...' : 'Create Attestation'}
                </button>
              </div>
            </div>
          </section>

          <section className="grid gap-6 md:grid-cols-2">
            <div className="nh-panel rounded-md p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-violet-50">Incoming Claim Requests</h3>
              <div className="mt-4 space-y-3">
                {requests.length === 0 ? (
                  <p className="text-sm nh-text-muted">No incoming requests yet.</p>
                ) : (
                  requests.map((req, index) => (
                    <div key={`${req[0].toString()}-${index}`} className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                      <p>Requester: {req[1]}</p>
                      <p>Purpose: {req[3]}</p>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p>Status: {req[4] ? 'Fulfilled' : 'Pending'}</p>
                        <button
                          type="button"
                          className="nh-button-primary rounded-xl px-3 py-1.5 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => openFulfillModal(req)}
                          disabled={req[4] || acceptingRequestId === req[0]}
                        >
                          {acceptingRequestId === req[0] ? 'Accepting...' : req[4] ? 'Accepted' : 'Accept'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="nh-panel rounded-md p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-violet-50">Attestations</h3>
              <div className="mt-4 space-y-3">
                {(attestations as readonly (AttestationTuple | AttestationObject)[] | undefined)?.length ? (
                  (attestations as readonly (AttestationTuple | AttestationObject)[]).map((att, index) => {
                    const from = isAttestationTuple(att) ? att[0] : att.attester
                    const statement = isAttestationTuple(att) ? att[2] : att.statement

                    return (
                      <div key={`${from ?? 'att'}-${index}`} className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                        <p>From: {from ?? '-'}</p>
                        <p>{statement ?? '-'}</p>
                      </div>
                    )
                  })
                ) : (
                  <p className="text-sm nh-text-muted">No attestations available.</p>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>

      {fulfillModalOpen && pendingFulfillRequest && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4" role="dialog" aria-modal="true" aria-labelledby="fulfill-claim-title">
          <section className="nh-panel w-full max-w-2xl rounded-lg p-5 sm:p-6">
            <p id="fulfill-claim-title" className="text-2xl font-bold text-violet-50 sm:text-3xl">
              Fulfill Claim Request
            </p>

            <div className="mt-4 space-y-2 text-sm text-violet-100/85">
              <p><span className="font-semibold text-violet-50">Requester:</span> {pendingFulfillRequest[1]}</p>
              <p><span className="font-semibold text-violet-50">Purpose:</span> {pendingFulfillRequest[3]}</p>
              <p><span className="font-semibold text-violet-50">Select one of your active credentials:</span></p>
            </div>

            <div className="mt-4 max-h-72 space-y-2 overflow-y-auto">
              {validCredentials.map((credential) => {
                const selected = selectedCredentialCid === credential.ipfsCID
                const meta = credentialMetaMap[credential.ipfsCID]

                return (
                  <label
                    key={credential.credentialHash}
                    className={`block cursor-pointer rounded-xl border p-3 text-sm transition ${
                      selected
                        ? 'border-violet-300/60 bg-violet-500/15'
                        : 'border-violet-300/20 bg-black/20 hover:border-violet-300/40'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="selectedCredential"
                        checked={selected}
                        onChange={() => setSelectedCredentialCid(credential.ipfsCID)}
                        className="mt-1 h-4 w-4 accent-violet-400"
                      />
                      <div className="min-w-0 text-violet-100/85">
                        <p className="font-semibold text-violet-50">
                          {meta?.title ?? (credentialMetaLoading ? 'Loading document...' : 'Credential')}
                        </p>
                        {meta?.type && (
                          <p className="text-xs text-violet-100/75">Type: {meta.type}</p>
                        )}
                        <p className="mt-1 font-semibold text-violet-50">CID</p>
                        <p className="break-all">{credential.ipfsCID}</p>
                      </div>
                    </div>
                  </label>
                )
              })}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeFulfillModal}
                disabled={acceptingRequestId !== null}
                className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleAcceptRequest()}
                disabled={acceptingRequestId !== null || !selectedCredentialCid}
                className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                {acceptingRequestId !== null ? 'Fulfilling...' : 'Fulfill Claim'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
