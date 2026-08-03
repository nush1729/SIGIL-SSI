import './globals.css'
import { Providers } from './providers'
import { ReactNode } from 'react'

export const metadata = {
  title: 'Sigil — Self-Sovereign Identity',
  description: 'Decentralized identity: issue, verify, and recover credentials on-chain.',
}

export default function RootLayout({
  children,
}: {
  children: ReactNode
}) {
  return (
    <html lang="en">
      <body className="bg-[#06040d] text-[#f3ecfb] antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
