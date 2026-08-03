'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  useAccount,
  useChainId,
  useDisconnect,
  useDeployContract,
  useReadContracts,
  useWriteContract,
  useConfig,
} from 'wagmi'
import { readContract, waitForTransactionReceipt } from 'wagmi/actions'
import { encodeFunctionData, isAddress } from 'viem'
import { identityConfig, identityBytecode } from '../../identity'
import {
  getStoredIdentityAddress,
  storeIdentityAddress,
  clearStoredIdentityAddress,
} from '../../identityStorage'
import { contractConfig } from '../../contract'
import { interactionHubConfig } from '../../interactionHub'
import { authenticateWithBiometric } from '../../biometricAuth'
import { DashboardHeader } from '../../components/home/DashboardHeader'
import { ViewToggle } from '../../components/home/ViewToggle'
import DecryptedText from '../../components/home/DecryptedText'
import { useToast } from '../../components/ui/ToastProvider'

type ClaimRequestTuple = readonly [bigint, `0x${string}`, `0x${string}`, string, boolean, bigint]

export default function GuardianPage() {
  const { address } = useAccount()
  const chainId = useChainId()
  const { disconnect } = useDisconnect()
  const router = useRouter()
  const config = useConfig()
  const toast = useToast()

  useEffect(() => {
    if (!address) {
      router.replace('/')
    }
  }, [address, router])

  const [identityAddress, setIdentityAddress] = useState<`0x${string}` | null>(null)
  const [guardianInput, setGuardianInput] = useState('')
  const [thresholdInput, setThresholdInput] = useState('2')
  const [timelockInput, setTimelockInput] = useState('3600')
  const [deploying, setDeploying] = useState(false)

  const [proposedNewOwner, setProposedNewOwner] = useState('')
  const [proposing, setProposing] = useState(false)
  const [voting, setVoting] = useState(false)
  const [finalizing, setFinalizing] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [authenticatingPropose, setAuthenticatingPropose] = useState(false)
  const [authenticatingVote, setAuthenticatingVote] = useState(false)
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000))

  const [credentialHashInput, setCredentialHashInput] = useState('')
  const [linking, setLinking] = useState(false)

  const [newGuardianInput, setNewGuardianInput] = useState('')
  const [addingGuardian, setAddingGuardian] = useState(false)
  const [removingGuardian, setRemovingGuardian] = useState<string | null>(null)
  const [newThresholdInput, setNewThresholdInput] = useState('')
  const [updatingThreshold, setUpdatingThreshold] = useState(false)

  const [incomingRequests, setIncomingRequests] = useState<ClaimRequestTuple[]>([])
  const [loadingIncomingRequests, setLoadingIncomingRequests] = useState(false)
  const [executingRequestId, setExecutingRequestId] = useState<bigint | null>(null)

  const { deployContractAsync } = useDeployContract()
  const { writeContractAsync } = useWriteContract()

  useEffect(() => {
    if (!address) return
    setIdentityAddress(getStoredIdentityAddress(address))
  }, [address])

  const identityContract = identityAddress
    ? { address: identityAddress, abi: identityConfig.abi }
    : null

  const { data: identityData, refetch: refetchIdentity } = useReadContracts({
    contracts: identityContract
      ? [
          { ...identityContract, functionName: 'owner' },
          { ...identityContract, functionName: 'guardianCount' },
          { ...identityContract, functionName: 'recoveryThreshold' },
          { ...identityContract, functionName: 'proposedOwner' },
          { ...identityContract, functionName: 'voteCount' },
          { ...identityContract, functionName: 'getLinkedCredentials' },
          { ...identityContract, functionName: 'getGuardians' },
          { ...identityContract, functionName: 'recoveryReadyAt' },
          { ...identityContract, functionName: 'recoveryTimelock' },
        ]
      : [],
    query: { enabled: Boolean(identityContract) },
  })

  const [
    owner,
    guardianCount,
    recoveryThreshold,
    proposedOwner,
    voteCount,
    linkedCredentials,
    guardianListResult,
    recoveryReadyAtResult,
    recoveryTimelockResult,
  ] = identityData ?? []

  const guardianAddressList = (guardianListResult?.result as string[] | undefined) ?? []
  const isCurrentOwner = Boolean(
    address && owner?.result && (owner.result as string).toLowerCase() === address.toLowerCase()
  )

  const linkedCredentialHashes = (linkedCredentials?.result as string[] | undefined) ?? []
  const proposedOwnerAddress = (proposedOwner?.result as string | undefined) ?? null
  const hasActiveProposal = Boolean(
    proposedOwnerAddress && proposedOwnerAddress !== '0x0000000000000000000000000000000000000000'
  )
  const recoveryReadyAt = Number((recoveryReadyAtResult?.result as bigint | undefined) ?? BigInt(0))
  const recoveryTimelockSeconds = Number((recoveryTimelockResult?.result as bigint | undefined) ?? BigInt(0))
  const thresholdReached = recoveryReadyAt > 0
  const timelockElapsed = thresholdReached && nowSeconds >= recoveryReadyAt
  const secondsRemaining = thresholdReached ? Math.max(0, recoveryReadyAt - nowSeconds) : 0

  useEffect(() => {
    if (!hasActiveProposal) return
    const interval = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(interval)
  }, [hasActiveProposal])

  async function handleDeploy() {
    if (!address) return

    const guardianAddresses = guardianInput
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean)

    if (guardianAddresses.length === 0) {
      toast.error('Enter at least one guardian wallet address.')
      return
    }

    for (const guardian of guardianAddresses) {
      if (!isAddress(guardian)) {
        toast.error(`Invalid guardian address: ${guardian}`)
        return
      }
    }

    const threshold = Number(thresholdInput)
    if (!Number.isInteger(threshold) || threshold <= 0 || threshold > guardianAddresses.length) {
      toast.error(`Threshold must be a whole number between 1 and ${guardianAddresses.length}.`)
      return
    }

    const timelockSeconds = Number(timelockInput)
    if (!Number.isInteger(timelockSeconds) || timelockSeconds < 0) {
      toast.error('Recovery timelock must be a whole number of seconds (0 or more).')
      return
    }

    if (!contractConfig.address) {
      toast.error('NEXT_PUBLIC_SSI_ADDRESS is not configured.')
      return
    }

    try {
      setDeploying(true)

      const hash = await deployContractAsync({
        abi: identityConfig.abi,
        bytecode: identityBytecode,
        args: [address, guardianAddresses, BigInt(threshold), contractConfig.address, BigInt(timelockSeconds)],
      })

      const receipt = await waitForTransactionReceipt(config, { hash })
      if (!receipt.contractAddress) {
        throw new Error('Deployment did not return a contract address.')
      }

      storeIdentityAddress(address, receipt.contractAddress)
      setIdentityAddress(receipt.contractAddress as `0x${string}`)
      toast.success('Guardian wallet deployed successfully.')
    } catch (err) {
      console.error(err)
      toast.error(err instanceof Error ? err.message : 'Failed to deploy guardian wallet.')
    } finally {
      setDeploying(false)
    }
  }

  function handleForget() {
    if (!address) return
    clearStoredIdentityAddress(address)
    setIdentityAddress(null)
  }

  useEffect(() => {
    async function loadIncomingRequests() {
      if (!identityAddress) {
        setIncomingRequests([])
        return
      }

      try {
        setLoadingIncomingRequests(true)
        const requestIds = await readContract(config, {
          ...interactionHubConfig,
          functionName: 'getRequestsForUser',
          args: [identityAddress],
        })

        const ids = (requestIds as bigint[] | undefined) ?? []
        if (ids.length === 0) {
          setIncomingRequests([])
          return
        }

        const results = await Promise.all(
          ids.map((id) =>
            readContract(config, {
              ...interactionHubConfig,
              functionName: 'claimRequests',
              args: [id],
            })
          )
        )
        setIncomingRequests(results as ClaimRequestTuple[])
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingIncomingRequests(false)
      }
    }

    void loadIncomingRequests()
  }, [config, identityAddress])

  // Demonstrates that credentials issued to this wallet's own address stay
  // reachable through whoever currently controls it — the original owner, or
  // a new owner after guardian recovery — by routing an interaction through
  // Identity.execute() instead of a direct wallet call.
  async function handleFulfillViaExecute(request: ClaimRequestTuple) {
    if (!identityContract) return

    try {
      setExecutingRequestId(request[0])
      const data = encodeFunctionData({
        abi: interactionHubConfig.abi,
        functionName: 'fulfillClaimRequest',
        args: [request[0]],
      })
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'execute',
        args: [interactionHubConfig.address, data],
      })
      await waitForTransactionReceipt(config, { hash })
      setIncomingRequests((prev) =>
        prev.map((req) => (req[0] === request[0] ? [req[0], req[1], req[2], req[3], true, req[5]] : req)) as ClaimRequestTuple[]
      )
      toast.success('Claim request fulfilled via your guardian wallet (Identity.execute).')
    } catch (err) {
      console.error(err)
      toast.error('Failed to fulfill — only the current owner of this wallet can call execute().')
    } finally {
      setExecutingRequestId(null)
    }
  }

  async function handleLinkCredential() {
    if (!identityContract || !credentialHashInput.trim()) {
      toast.info('Enter a credential hash to link first.')
      return
    }

    try {
      setLinking(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'linkCredential',
        args: [credentialHashInput.trim() as `0x${string}`],
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Credential linked to your guardian wallet.')
      setCredentialHashInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to link credential — it must be a valid, unrevoked credential issued to your wallet.')
    } finally {
      setLinking(false)
    }
  }

  async function handleAddGuardian() {
    if (!identityContract) return
    if (!isAddress(newGuardianInput)) {
      toast.error('Enter a valid guardian wallet address.')
      return
    }

    try {
      setAddingGuardian(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'addGuardian',
        args: [newGuardianInput as `0x${string}`],
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Guardian added.')
      setNewGuardianInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to add guardian — only the owner can do this, and not while a recovery proposal is active.')
    } finally {
      setAddingGuardian(false)
    }
  }

  async function handleRemoveGuardian(guardianAddress: string) {
    if (!identityContract) return

    try {
      setRemovingGuardian(guardianAddress)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'removeGuardian',
        args: [guardianAddress as `0x${string}`],
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Guardian removed.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to remove guardian — this would drop below the recovery threshold, or a proposal is active.')
    } finally {
      setRemovingGuardian(null)
    }
  }

  async function handleUpdateThreshold() {
    if (!identityContract) return
    const threshold = Number(newThresholdInput)
    if (!Number.isInteger(threshold) || threshold <= 0) {
      toast.error('Enter a valid whole number threshold.')
      return
    }

    try {
      setUpdatingThreshold(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'setRecoveryThreshold',
        args: [BigInt(threshold)],
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Recovery threshold updated.')
      setNewThresholdInput('')
    } catch (err) {
      console.error(err)
      toast.error('Failed to update threshold — must be between 1 and the guardian count, and no proposal can be active.')
    } finally {
      setUpdatingThreshold(false)
    }
  }

  async function handleProposeRecovery() {
    if (!identityContract || !address) return
    if (!isAddress(proposedNewOwner)) {
      toast.error('Enter a valid new owner wallet address.')
      return
    }

    setAuthenticatingPropose(true)
    const biometricResult = await authenticateWithBiometric(address)
    setAuthenticatingPropose(false)

    if (!biometricResult.ok) {
      toast.error(biometricResult.message)
      return
    }

    try {
      setProposing(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'proposeRecovery',
        args: [proposedNewOwner as `0x${string}`],
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Recovery proposed.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to propose recovery. Only guardians can do this.')
    } finally {
      setProposing(false)
    }
  }

  async function handleVoteRecovery() {
    if (!identityContract || !address) return

    setAuthenticatingVote(true)
    const biometricResult = await authenticateWithBiometric(address)
    setAuthenticatingVote(false)

    if (!biometricResult.ok) {
      toast.error(biometricResult.message)
      return
    }

    try {
      setVoting(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'voteRecovery',
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Vote recorded.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to vote. Only guardians can vote, and only once per proposal.')
    } finally {
      setVoting(false)
    }
  }

  // Permissionless on-chain (see Identity.sol) — anyone can finalize once the
  // timelock elapses, so the UI doesn't gate this on being the owner/guardian.
  async function handleFinalizeRecovery() {
    if (!identityContract) return

    try {
      setFinalizing(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'finalizeRecovery',
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Recovery finalized — ownership transferred.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to finalize — the timelock may not have elapsed yet.')
    } finally {
      setFinalizing(false)
    }
  }

  // Lets the current owner abort a recovery they did not authorize (e.g.
  // colluding/malicious guardians) any time before it finalizes.
  async function handleCancelRecovery() {
    if (!identityContract || !address) return

    setAuthenticatingPropose(true)
    const biometricResult = await authenticateWithBiometric(address)
    setAuthenticatingPropose(false)

    if (!biometricResult.ok) {
      toast.error(biometricResult.message)
      return
    }

    try {
      setCancelling(true)
      const hash = await writeContractAsync({
        ...identityContract,
        functionName: 'cancelRecovery',
      })
      await waitForTransactionReceipt(config, { hash })
      await refetchIdentity()
      toast.success('Recovery cancelled.')
    } catch (err) {
      console.error(err)
      toast.error('Failed to cancel — only the current owner can do this.')
    } finally {
      setCancelling(false)
    }
  }

  if (!address) {
    return null
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <main className="space-y-6">
          <div className="flex justify-start">
            <ViewToggle active="guardian" />
          </div>

          <DashboardHeader chainId={chainId} />

          <section className="relative overflow-hidden rounded-md px-6 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
            <div className="flex items-start justify-between gap-4">
              <p className="nh-chip inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">
                Sigil Guardian Wallet
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
                sovereign recovery
                <span className="block bg-linear-to-r from-violet-400/25 to-transparent px-2 text-violet-200">
                  <DecryptedText
                    text="guardians, not gatekeepers"
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
                Deploy a guardian-recovery smart wallet, link your credentials to it, and recover ownership via guardian votes if a key is lost.
              </p>
            </div>
          </section>

          {!identityAddress && (
            <section className="nh-panel rounded-md p-5 sm:p-6">
              <h3 className="text-lg font-semibold text-violet-50">Deploy Your Guardian Wallet</h3>
              <p className="mt-1 text-sm nh-text-muted">
                This deploys a new Identity contract owned by your connected wallet. You choose the guardians and how many votes are needed to recover ownership.
              </p>

              <div className="mt-4 space-y-3">
                <input
                  className="nh-input w-full rounded-xl px-3 py-2.5 font-mono text-sm"
                  placeholder="Guardian addresses, comma-separated"
                  value={guardianInput}
                  onChange={(e) => setGuardianInput(e.target.value)}
                />
                <input
                  className="nh-input w-full rounded-xl px-3 py-2.5 text-sm sm:w-48"
                  type="number"
                  min={1}
                  placeholder="Recovery threshold"
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(e.target.value)}
                />
                <div>
                  <input
                    className="nh-input w-full rounded-xl px-3 py-2.5 text-sm sm:w-64"
                    type="number"
                    min={0}
                    placeholder="Recovery timelock (seconds)"
                    value={timelockInput}
                    onChange={(e) => setTimelockInput(e.target.value)}
                  />
                  <p className="mt-1 text-xs nh-text-muted">
                    Delay between guardian votes reaching threshold and recovery actually
                    completing — gives you a window to cancel a recovery you didn&apos;t authorize.
                    Default 3600s (1 hour); 0 disables the delay.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDeploy}
                  disabled={deploying}
                  className="nh-button-primary rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {deploying ? 'Deploying...' : 'Deploy Guardian Wallet'}
                </button>
              </div>
            </section>
          )}

          {identityAddress && (
            <>
              <section className="nh-panel rounded-md p-5 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                  <h3 className="text-lg font-semibold text-violet-50">Your Guardian Wallet</h3>
                  <button
                    type="button"
                    onClick={handleForget}
                    className="nh-button-secondary rounded-xl px-3 py-1.5 text-xs font-semibold"
                  >
                    Forget this address
                  </button>
                </div>
                <p className="mt-2 break-all font-mono text-sm text-violet-100/85">{identityAddress}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-violet-100/70">Current Owner</p>
                    <p className="mt-1 break-all font-mono text-violet-50">{String(owner?.result ?? '—')}</p>
                  </div>
                  <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-violet-100/70">Guardians</p>
                    <p className="mt-1 font-mono text-violet-50">{String(guardianCount?.result ?? '—')}</p>
                  </div>
                  <div className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-violet-100/70">Recovery Threshold</p>
                    <p className="mt-1 font-mono text-violet-50">{String(recoveryThreshold?.result ?? '—')}</p>
                  </div>
                </div>
              </section>

              <section className="nh-panel rounded-md p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-violet-50">Manage Guardians</h3>
                <p className="mt-1 text-sm nh-text-muted">
                  Guardians can change over your wallet&apos;s lifetime — add trusted contacts or
                  remove ones you no longer trust. Locked while a recovery vote is in progress, so
                  a compromised owner can&apos;t kick out guardians about to recover the wallet.
                </p>

                {guardianAddressList.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {guardianAddressList.map((guardianAddress) => (
                      <div
                        key={guardianAddress}
                        className="flex items-center justify-between gap-3 rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm"
                      >
                        <span className="break-all font-mono text-violet-100/85">{guardianAddress}</span>
                        {isCurrentOwner && (
                          <button
                            type="button"
                            onClick={() => handleRemoveGuardian(guardianAddress)}
                            disabled={removingGuardian === guardianAddress}
                            className="nh-button-secondary shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {removingGuardian === guardianAddress ? 'Removing...' : 'Remove'}
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {isCurrentOwner && (
                  <>
                    <div className="mt-4 flex flex-wrap gap-3">
                      <input
                        className="nh-input flex-1 rounded-xl px-3 py-2.5 font-mono text-sm"
                        placeholder="New guardian wallet address"
                        value={newGuardianInput}
                        onChange={(e) => setNewGuardianInput(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={handleAddGuardian}
                        disabled={addingGuardian}
                        className="nh-button-primary rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {addingGuardian ? 'Adding...' : 'Add Guardian'}
                      </button>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <input
                        className="nh-input w-full rounded-xl px-3 py-2.5 text-sm sm:w-56"
                        type="number"
                        min={1}
                        placeholder="New recovery threshold"
                        value={newThresholdInput}
                        onChange={(e) => setNewThresholdInput(e.target.value)}
                      />
                      <button
                        type="button"
                        onClick={handleUpdateThreshold}
                        disabled={updatingThreshold}
                        className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {updatingThreshold ? 'Updating...' : 'Update Threshold'}
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="nh-panel rounded-md p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-violet-50">Link a Credential</h3>
                <p className="mt-1 text-sm nh-text-muted">
                  For a credential to actually survive a future recovery, it must be issued to{' '}
                  <strong className="text-violet-100">this wallet&apos;s own address</strong> (shown
                  above), not your personal wallet address — paste{' '}
                  <span className="break-all font-mono text-xs">{identityAddress}</span> as the
                  recipient on the Issuer Dashboard. Then link the resulting credential hash here so
                  this wallet has a record of it. Whoever controls this contract (you, or a future
                  owner after guardian recovery) can act on it via <code>execute()</code>.
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  <input
                    className="nh-input flex-1 rounded-xl px-3 py-2.5 font-mono text-sm"
                    placeholder="0x... credential hash"
                    value={credentialHashInput}
                    onChange={(e) => setCredentialHashInput(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleLinkCredential}
                    disabled={linking}
                    className="nh-button-primary rounded-xl px-5 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {linking ? 'Linking...' : 'Link Credential'}
                  </button>
                </div>

                {linkedCredentialHashes.length > 0 && (
                  <div className="mt-4 space-y-2">
                    {linkedCredentialHashes.map((hash) => (
                      <p key={hash} className="break-all rounded-xl border border-violet-300/20 bg-black/20 p-2 font-mono text-xs text-violet-100/80">
                        {hash}
                      </p>
                    ))}
                  </div>
                )}
              </section>

              <section className="nh-panel rounded-md p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-violet-50">Interactions via Guardian Wallet</h3>
                <p className="mt-1 text-sm nh-text-muted">
                  Claim requests addressed to <span className="break-all font-mono text-xs">{identityAddress}</span>{' '}
                  itself — fulfilling one here routes the call through{' '}
                  <code>Identity.execute()</code>, proving that whoever controls this wallet (you now,
                  or a new owner after guardian recovery) can act on interactions sent to it, not just
                  read its state.
                </p>

                <div className="mt-4 space-y-2">
                  {loadingIncomingRequests ? (
                    <p className="text-sm nh-text-muted">Loading incoming requests...</p>
                  ) : incomingRequests.length === 0 ? (
                    <p className="text-sm nh-text-muted">
                      No claim requests addressed to this wallet yet. Send one from the Interactions
                      page, targeting {identityAddress ? 'this address' : 'your guardian wallet'}, to try it.
                    </p>
                  ) : (
                    incomingRequests.map((request) => (
                      <div
                        key={request[0].toString()}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="break-all font-mono text-xs text-violet-100/70">From: {request[1]}</p>
                          <p className="mt-1 text-violet-100/85">{request[3]}</p>
                          <p className="mt-1 text-xs text-violet-100/60">{request[4] ? 'Fulfilled' : 'Pending'}</p>
                        </div>
                        {!request[4] && (
                          <button
                            type="button"
                            onClick={() => handleFulfillViaExecute(request)}
                            disabled={!isCurrentOwner || executingRequestId === request[0]}
                            className="nh-button-primary shrink-0 rounded-xl px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {executingRequestId === request[0] ? 'Executing...' : 'Fulfill via execute()'}
                          </button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </section>

              <section className="nh-panel rounded-md p-5 sm:p-6">
                <h3 className="text-lg font-semibold text-violet-50">Guardian Recovery</h3>
                <p className="mt-1 text-sm nh-text-muted">
                  If you are a guardian of this wallet, propose a new owner and vote. Once enough
                  guardians vote, a {recoveryTimelockSeconds}s timelock starts — recovery only
                  completes after it elapses, and the current owner can cancel it any time before
                  then.
                </p>

                {hasActiveProposal && (
                  <div className="mt-3 rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm">
                    <p className="text-xs uppercase tracking-wide text-violet-100/70">Active Proposal</p>
                    <p className="mt-1 break-all font-mono text-violet-50">{String(proposedOwnerAddress)}</p>
                    <p className="mt-1 text-violet-100/70">
                      Votes: {String(voteCount?.result ?? 0)} / {String(recoveryThreshold?.result ?? '—')}
                    </p>

                    {thresholdReached && (
                      <div className="mt-3 border-t border-violet-300/20 pt-3">
                        <p className="text-xs uppercase tracking-wide text-violet-100/70">
                          Threshold reached
                        </p>
                        <p className="mt-1 text-violet-100/85">
                          {timelockElapsed
                            ? 'Timelock elapsed — recovery is ready to finalize.'
                            : `Finalizable in ${secondsRemaining}s.`}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-3">
                          <button
                            type="button"
                            onClick={handleFinalizeRecovery}
                            disabled={!timelockElapsed || finalizing}
                            className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {finalizing ? 'Finalizing...' : 'Finalize Recovery'}
                          </button>
                          {isCurrentOwner && (
                            <button
                              type="button"
                              onClick={handleCancelRecovery}
                              disabled={cancelling || authenticatingPropose}
                              className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {authenticatingPropose
                                ? 'Authenticating...'
                                : cancelling
                                  ? 'Cancelling...'
                                  : "This wasn't me — Cancel Recovery"}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {!thresholdReached && isCurrentOwner && (
                      <div className="mt-3 border-t border-violet-300/20 pt-3">
                        <button
                          type="button"
                          onClick={handleCancelRecovery}
                          disabled={cancelling || authenticatingPropose}
                          className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          {authenticatingPropose
                            ? 'Authenticating...'
                            : cancelling
                              ? 'Cancelling...'
                              : "This wasn't me — Cancel Recovery"}
                        </button>
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-3">
                  <input
                    className="nh-input flex-1 rounded-xl px-3 py-2.5 font-mono text-sm"
                    placeholder="New owner wallet address"
                    value={proposedNewOwner}
                    onChange={(e) => setProposedNewOwner(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleProposeRecovery}
                    disabled={proposing || authenticatingPropose}
                    className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authenticatingPropose ? 'Authenticating...' : proposing ? 'Proposing...' : 'Propose Recovery'}
                  </button>
                  <button
                    type="button"
                    onClick={handleVoteRecovery}
                    disabled={voting || authenticatingVote || thresholdReached}
                    className="nh-button-primary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {authenticatingVote ? 'Authenticating...' : voting ? 'Voting...' : 'Vote to Recover'}
                  </button>
                </div>
              </section>
            </>
          )}
        </main>
    </div>
  )
}
