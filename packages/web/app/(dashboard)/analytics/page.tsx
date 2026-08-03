'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useChainId, useDisconnect } from 'wagmi'
import { DashboardHeader } from '../../components/home/DashboardHeader'
import { BlockchainAnalyticsSection } from '../../components/home/BlockchainAnalyticsSection'
import { ViewToggle } from '../../components/home/ViewToggle'
import DecryptedText from '../../components/home/DecryptedText'

export default function AnalyticsPage() {
  const { address } = useAccount()
  const chainId = useChainId()
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
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <main className="space-y-6">
        <div className="flex justify-start">
          <ViewToggle active="analytics" />
        </div>

        <DashboardHeader chainId={chainId} />

        <section className="relative overflow-hidden rounded-md px-6 pb-6 pt-2 sm:px-6 sm:pb-6 sm:pt-2">
          <div className="flex items-start justify-between gap-4">
            <p className="nh-chip inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide">
              Sigil Analytics Space
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
              analytics portal
              <span className="block bg-linear-to-r from-violet-400/25 to-transparent px-2 text-violet-200">
                <DecryptedText
                  text="on-chain graph insights"
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

        <BlockchainAnalyticsSection address={address} chainId={chainId} />
      </main>
    </div>
  )
}
