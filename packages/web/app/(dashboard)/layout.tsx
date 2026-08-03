import { ReactNode } from 'react'
import ColorBends from '../components/home/ColorBends'

// Shared across every dashboard page (issuer/verify/guardian/interactions/
// analytics) so the WebGL background persists across client-side
// navigation between them instead of being torn down and recreated (fresh
// WebGLRenderer + shader compile) on every page switch — this was a real
// contributor to navigation feeling slow, since each remount pays GPU
// context/shader-compile cost from scratch.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-transparent text-violet-50">
      <div className="pointer-events-none absolute inset-0 opacity-75">
        <ColorBends
          className="h-full w-full"
          colors={['#a855f7', '#7c3aed', '#0d0518', '#050308']}
          speed={0.16}
          noise={0.02}
          parallax={0.45}
          mouseInfluence={0.9}
          warpStrength={1.0}
          frequency={1.0}
          autoRotate={0.28}
          scale={1.2}
        />
      </div>
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(2,2,4,0.72)_0%,rgba(2,2,4,0.84)_100%)]" />
      <div className="relative z-10">{children}</div>
    </div>
  )
}
