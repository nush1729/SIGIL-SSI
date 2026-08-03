'use client'

import '@rainbow-me/rainbowkit/styles.css'
import { getDefaultConfig, RainbowKitProvider } from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import { sepolia } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactNode, useSyncExternalStore } from 'react'
import { ToastProvider } from './components/ui/ToastProvider'

const config = getDefaultConfig({
  appName: 'Sigil',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || 'demo',
  chains: [sepolia],
  ssr: true,
})

const queryClient = new QueryClient()
const subscribe = () => () => {}

export function Providers({ children }: { children: ReactNode }) {
  const mounted = useSyncExternalStore(subscribe, () => true, () => false)

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>
          {mounted ? <RainbowKitProvider>{children}</RainbowKitProvider> : children}
        </ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
