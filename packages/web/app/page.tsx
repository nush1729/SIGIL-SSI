'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount } from 'wagmi'
import ColorBends from './components/home/ColorBends'
import TextType from './components/home/TextType'
import MagicBento from './components/home/MagicBento'
import HeroSigil from './components/home/HeroSigil'
import SigilMark from './components/home/SigilMark'

export default function Home() {
  const { address } = useAccount()
  const router = useRouter()
  const pinRefs = useRef<(HTMLButtonElement | null)[]>([])
  const [activeAnalysisIndex, setActiveAnalysisIndex] = useState(0)

  const analysisCards = [
    {
      title: 'Blockchain Integrity Layer',
      points: [
        'Credential payload hashes are anchored on-chain, while rich metadata lives on IPFS.',
        'Issuer trust checks run through the trust registry before workflows proceed.',
        'Revocation state is on-chain, reducing ambiguity during verification.',
      ],
    },
    {
      title: 'Security Controls',
      points: [
        'Wallet signatures gate every write operation — issuance, revocation, claim requests, attestations, and recovery votes.',
        'Issuance is gated by an on-chain trust registry check, not just a connected wallet: only allow-listed issuer addresses can call issueCredential.',
        'WebAuthn biometric confirmation is required before issuance, revocation, selective disclosure, and guardian-recovery propose/vote — every action that creates, destroys, discloses, or reassigns control of a credential or wallet.',
      ],
    },
    {
      title: 'Novelty + Feature Depth',
      points: [
        'Closes the anchor-vs-verify gap: many comparable designs anchor a Merkle root on-chain but only claim inclusion off-chain. Here, verifyBatchInclusion runs OpenZeppelin’s MerkleProof.verify() on-chain, so a verifier checks a real cryptographic proof, not a trust assertion.',
        'Ships as a fix to a concrete, named vulnerability rather than a generic security claim: the original issuance function had no access control at all — any address could mint a credential claiming any issuer. It is now hard-gated behind the trust registry, with a regression test asserting the revert.',
        'Combines guardian-based social recovery with hardware-backed biometric gating in one flow: an M-of-N guardian vote reassigns control of a lost wallet with no centralized reissuance authority, and each guardian must clear a platform-authenticator prompt to propose or cast that vote.',
        'One canonical credential store: the guardian wallet references credentials by verified hash instead of keeping a second, divergent copy — closing a two-ledger inconsistency risk common in systems that split issuance and identity into separate unlinked contracts.',
      ],
    },
    {
      title: 'Scalability and Architecture',
      points: [
        'On-chain state remains compact (hashes/status), while documents and JSON scale via IPFS.',
        'Modular app-router pages separate issuer, verifier, analytics, and interactions responsibilities.',
        'Contract reads/writes are abstracted with wagmi + viem for predictable wallet/RPC behavior.',
      ],
    },
  ]

  const pinLayout = [
    { left: '14%', top: '74%' },
    { left: '33%', top: '40%' },
    { left: '67%', top: '60%' },
    { left: '88%', top: '30%' },
  ]

  const digilockerComparison = [
    {
      risk: 'Centralized tamper risk',
      mitigation:
        'Sigil stores immutable credential fingerprints on-chain, so post-issuance edits become detectable.',
    },
    {
      risk: 'Single trust bottleneck',
      mitigation:
        'Issuer trust is explicit and queryable via the trust registry instead of opaque, monolithic trust assumptions.',
    },
    {
      risk: 'Over-disclosure of personal data',
      mitigation:
        'Selective claim/disclosure paths share required fields only, limiting broad document exposure.',
    },
    {
      risk: 'Weak auditability of sharing events',
      mitigation:
        'Claims, attestations, and status transitions are anchored as verifiable transaction history.',
    },
  ]

  useEffect(() => {
    if (address) {
      router.push('/choose')
    }
  }, [address, router])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return
          const target = entry.target as HTMLElement
          const index = Number(target.dataset.pinIndex)
          if (!Number.isNaN(index)) {
            setActiveAnalysisIndex(index)
          }
        })
      },
      {
        threshold: 0.72,
      },
    )

    pinRefs.current.forEach((pin) => {
      if (pin) observer.observe(pin)
    })

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-violet-50">
      <div className="pointer-events-none absolute inset-0">
        <ColorBends
          className="h-full w-full"
          colors={['#a855f7', '#7c3aed', '#0d0518', '#050308']}
          speed={0.2}
          noise={0.02}
          parallax={0.55}
          mouseInfluence={1.0}
          warpStrength={1.05}
          frequency={1.0}
          autoRotate={0.38}
          scale={1.2}
        />
      </div>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(139,92,246,0.2),transparent_36%),radial-gradient(circle_at_80%_72%,rgba(217,70,239,0.16),transparent_32%),linear-gradient(180deg,rgba(2,2,4,0.62)_0%,rgba(2,2,4,0.72)_100%)]" />

      <div className="relative z-10 mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
        <main className="space-y-16 sm:space-y-20">
          <section className="grid min-h-[70vh] items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="max-w-3xl">
            <div className="inline-flex items-center gap-3">
              <span className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-violet-300/45 bg-linear-to-br from-violet-500/30 to-violet-700/20">
                <SigilMark className="h-5 w-5" />
              </span>
              <span className="font-mono text-base font-bold tracking-[0.28em] text-violet-100/95 sm:text-lg">
                SIGIL
              </span>
            </div>
            <h1 className="mt-6 text-4xl font-black leading-tight text-white sm:text-6xl">
              <TextType
                as="span"
                text={['Issue and verify trusted credentials', 'with decentralized identity']}
                textColors={['#ffffff', '#e9d5ff']}
                className="block"
                typingSpeed={42}
                initialDelay={100}
                loop={false}
                showCursor={true}
                hideCursorWhileTyping={false}
                hideCursorOnComplete={true}
              />
            </h1>
            <p className="mt-4 max-w-9xl font-mono text-sm text-violet-100/80 sm:text-base">
              Create tamper-evident credentials, store proofs on IPFS, and verify authenticity with cryptographic confidence.
            </p>
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <div className="scale-[1.04]">
                <ConnectButton label="Connect Wallet" />
              </div>
            </div>
            <p className="mt-4 text-sm text-violet-100/80 font-mono sm:text-base">Issue credentials securely, store hashes and metadata on-chain + IPFS, and verify authenticity in one flow.</p>
            </div>
            <div className="relative mx-auto w-full max-w-xl lg:justify-self-end">
              <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(circle_at_center,rgba(139,92,246,0.28),transparent_62%)] blur-2xl" />
              <HeroSigil className="h-auto w-full object-contain" />
            </div>
          </section>

          <section className="space-y-4">
            <div className="w-full">
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-violet-200/85">Platform Direction</p>
              <h2 className="mt-2 text-2xl font-black text-white sm:text-3xl">
                Built for verifiable trust at <span className="text-[#e9d5ff]">internet scale</span>
              </h2>
              <p className="mt-3 w-full max-w-5xl text-sm text-violet-100/80 sm:text-base">
                Sigil focuses on high-integrity identity workflows: trusted issuers, portable proofs, selective disclosure, and auditable revocation.
                The platform intent is to reduce manual verification friction while preserving user control over personal data.
              </p>
            </div>

            <div className="mt-4 w-full">
              <MagicBento
                enableStars={true}
                enableSpotlight={true}
                enableBorderGlow={true}
                enableTilt={false}
                clickEffect={true}
                enableMagnetism={true}
                textAutoHide={false}
                particleCount={10}
                glowColor="139, 92, 246"
              />
            </div>

            <div className="mt-8">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-violet-200/85">
                Product Analysis
              </p>
              <h3 className="mt-2 text-2xl font-black text-white sm:text-3xl">
                System review across security, architecture, novelty, and scale
              </h3>
              <p className="mt-3 text-sm text-violet-100/80 sm:text-base">
                This implementation follows a hybrid trust model: blockchain for integrity + state transitions, and IPFS for portable credential payloads.
                The result is stronger provenance and verification posture than centralized document locker patterns.
              </p>

              <div className="relative mt-5 -mx-4 sm:-mx-6 lg:-mx-10">
                <div className="relative h-170 w-full">
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(139,92,246,0.1),transparent_38%),radial-gradient(circle_at_78%_72%,rgba(217,70,239,0.09),transparent_34%)]" />
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="pointer-events-none absolute inset-0 h-full w-full"
                    aria-hidden="true"
                  >
                    <path d="M0,86 C18,20 38,50 54,56 C68,62 80,18 100,22" fill="none" stroke="rgba(196,181,253,0.6)" strokeWidth="0.65" />
                  </svg>

                  {analysisCards.map((card, index) => {
                    const isActive = activeAnalysisIndex === index
                    const position = pinLayout[index]

                    return (
                      <div
                        key={card.title}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: position.left, top: position.top }}
                      >
                        <button
                          ref={(element) => {
                            pinRefs.current[index] = element
                          }}
                          data-pin-index={index}
                          onMouseEnter={() => setActiveAnalysisIndex(index)}
                          onFocus={() => setActiveAnalysisIndex(index)}
                          onClick={() => setActiveAnalysisIndex(index)}
                          className="group rounded-md border border-violet-300/40 bg-black/45 px-3 py-2 text-left backdrop-blur-sm"
                          aria-expanded={isActive}
                          aria-controls={`analysis-pin-panel-${index}`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="relative inline-flex h-3.5 w-3.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-violet-300/50" />
                              <span className="relative inline-flex h-3.5 w-3.5 rounded-full border border-violet-200 bg-violet-300" />
                            </span>
                            <span className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-50">
                              {card.title}
                            </span>
                          </div>
                        </button>

                        <article
                          id={`analysis-pin-panel-${index}`}
                          className={`nh-glass mt-3 w-[min(78vw,360px)] rounded-md border border-violet-200/30 bg-black/58 p-3 text-violet-50/95 shadow-[0_14px_40px_rgba(0,0,0,0.42)] backdrop-blur-xl transition-all duration-300 ${
                            isActive
                              ? 'pointer-events-auto max-h-80 opacity-100'
                              : 'pointer-events-none max-h-0 overflow-hidden opacity-0'
                          }`}
                        >
                          <ul className="space-y-2 text-sm text-violet-100/80">
                            {card.points.map((point) => (
                              <li key={point} className="flex gap-2">
                                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-300/80" />
                                <span>{point}</span>
                              </li>
                            ))}
                          </ul>
                        </article>
                      </div>
                    )
                  })}
                </div>
              </div>

              <div className="mt-12">
                <div className="relative mt-6 overflow-hidden rounded-[2.25rem] border border-violet-300/20 bg-black/40 px-6 pb-10 pt-10 sm:px-10 sm:pt-14">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-56 bg-[radial-gradient(ellipse_at_top,rgba(217,70,239,0.28),transparent_64%)]" />
                  <div className="pointer-events-none absolute left-1/2 top-18 h-168 w-[min(1500px,168vw)] -translate-x-1/2 rounded-full border border-violet-300/25 bg-[radial-gradient(circle_at_50%_100%,rgba(0,0,0,0.82)_44%,rgba(217,70,239,0.14)_80%,rgba(217,70,239,0)_100%)] shadow-[0_0_120px_rgba(217,70,239,0.18)]" />

                  <div className="pointer-events-none absolute left-[8%] top-16 h-1.5 w-1.5 rounded-full bg-violet-200/90" />
                  <div className="pointer-events-none absolute left-[18%] top-24 h-1 w-1 rounded-full bg-violet-200/70" />
                  <div className="pointer-events-none absolute right-[14%] top-20 h-1.5 w-1.5 rounded-full bg-violet-200/90" />
                  <div className="pointer-events-none absolute right-[24%] top-28 h-1 w-1 rounded-full bg-violet-200/70" />

                  <div className="relative z-10">
                    <p className="mx-auto inline-flex rounded-full border border-violet-300/25 bg-black/45 px-3 py-1 text-xs font-semibold uppercase tracking-[0.14em] text-violet-100/85">
                      Risk Coverage
                    </p>
                    <h4 className="mx-auto mt-4 max-w-3xl text-center text-2xl font-black text-white sm:text-3xl">
                      DigiLocker-style risk comparison and mitigation coverage
                    </h4>
                    <p className="mx-auto mt-3 max-w-3xl text-center text-sm text-violet-100/75 sm:text-base">
                      Compared to centralized locker approaches, this design distributes trust, keeps audit trails tamper-evident,
                      and minimizes broad data exposure in verification workflows.
                    </p>

                    <div className="mt-12 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {digilockerComparison.map((item) => (
                        <article
                          key={item.risk}
                          className="rounded-2xl border border-violet-300/20 bg-black/45 p-4 backdrop-blur-lg"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2.5 w-2.5 rounded-full bg-violet-300" />
                            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-violet-200/90">Risk</p>
                          </div>
                          <p className="mt-2 text-sm font-bold text-violet-50">{item.risk}</p>
                          <p className="mt-3 text-sm leading-relaxed text-violet-100/80">{item.mitigation}</p>
                        </article>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            
          </section>

        </main>

        <footer className="mt-12 border-t border-violet-300/20 pt-6">
          <div className="grid gap-5 text-sm text-violet-100/75 md:grid-cols-3">
            <div>
              <p>
                <span className="inline-flex items-center gap-2">
                  <SigilMark className="h-4 w-4" />
                  <span className="font-semibold text-violet-200">Sigil</span>
                </span>{' '}
                · Verifiable credentials platform for issuance, trust, and secure verification.
              </p>
              <p className="mt-2 text-violet-100/70">
                Designed for tamper-evident provenance, portable credentials, and wallet-centric identity control.
              </p>
            </div>

            <div>
              <p className="font-semibold text-violet-200">Architecture + Stack</p>
              <ul className="mt-2 space-y-1 text-violet-100/70">
                <li>Next.js App Router + TypeScript UI</li>
                <li>wagmi + viem for contract I/O</li>
                <li>IPFS/Pinata for credential metadata and file storage</li>
              </ul>
            </div>

            <div>
              <p className="font-semibold text-violet-200">Security Posture</p>
              <ul className="mt-2 space-y-1 text-violet-100/70">
                <li>On-chain hash anchoring and revocation visibility</li>
                <li>Trust registry checks for issuer reputation</li>
                <li>Biometric gating for sensitive user actions</li>
              </ul>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-2 border-t border-violet-300/15 pt-4 text-xs text-violet-100/65 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-mono inline-flex items-center gap-2">
              <SigilMark className="h-3.5 w-3.5" />
              <span>© 2026 Sigil · Built for decentralized identity workflows</span>
            </p>
            <p>Hybrid model: decentralized integrity + scalable off-chain document delivery</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
