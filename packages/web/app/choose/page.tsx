'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useAccount, useDisconnect } from 'wagmi'
import ColorBends from '../components/home/ColorBends'

export default function ChoosePage() {
  const { address } = useAccount()
  const { disconnect } = useDisconnect()
  const router = useRouter()

  useEffect(() => {
    if (!address) {
      router.replace('/')
    }
  }, [address, router])

  if (!address) {
    return null
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-violet-50">
      <div className="pointer-events-none absolute inset-0 opacity-75">
        <ColorBends
          className="h-full w-full"
          colors={['#a855f7', '#7c3aed', '#0d0518', '#050308']}
          speed={0.18}
          noise={0.02}
          parallax={0.45}
          mouseInfluence={0.9}
          warpStrength={1.0}
          frequency={1.0}
          autoRotate={0.3}
          scale={1.15}
        />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,2,4,0.72)_0%,rgba(2,2,4,0.84)_100%)]" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-5xl items-center justify-center px-4 py-10 sm:px-6 lg:px-8">
        <section className="nh-panel w-full rounded-xl p-8 sm:p-10">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="nh-chip inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">Role Selection</p>
              <h1 className="mt-4 text-3xl font-black text-violet-50 sm:text-4xl">Choose where to continue</h1>
              <p className="mt-2 text-sm text-violet-100/75">Select the workspace you want to open.</p>
            </div>
            <button
              type="button"
              onClick={() => {
                disconnect()
                router.replace('/')
              }}
              className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold transition"
            >
              Disconnect
            </button>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <Link
              href="/issuer"
              className="nh-glass rounded-lg border border-violet-400/30 p-6 transition hover:border-violet-300/60 hover:bg-white/10"
            >
              <h2 className="text-xl font-black text-violet-50">Issuer Dashboard</h2>
              <p className="mt-2 text-sm text-violet-100/75">Issue, revoke, and manage credentials.</p>
            </Link>

            <Link
              href="/verify"
              className="nh-glass rounded-lg border border-violet-400/30 p-6 transition hover:border-violet-300/60 hover:bg-white/10"
            >
              <h2 className="text-xl font-black text-violet-50">Verifier Portal</h2>
              <p className="mt-2 text-sm text-violet-100/75">Verify integrity and perform selective disclosure.</p>
            </Link>

            <Link
              href="/guardian"
              className="nh-glass rounded-lg border border-violet-400/30 p-6 transition hover:border-violet-300/60 hover:bg-white/10"
            >
              <h2 className="text-xl font-black text-violet-50">Guardian Wallet</h2>
              <p className="mt-2 text-sm text-violet-100/75">Deploy social recovery and link your credentials.</p>
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}
