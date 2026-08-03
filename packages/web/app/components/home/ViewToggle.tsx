import Link from 'next/link'
import SigilMark from './SigilMark'

const TABS: { href: string; label: string; key: 'issuer' | 'verifier' | 'analytics' | 'interactions' | 'guardian' }[] = [
  { href: '/issuer', label: 'Issuer Dashboard', key: 'issuer' },
  { href: '/verify', label: 'Verifier Portal', key: 'verifier' },
  { href: '/analytics', label: 'Analytics Portal', key: 'analytics' },
  { href: '/interactions', label: 'Interactions Portal', key: 'interactions' },
  { href: '/guardian', label: 'Guardian Wallet', key: 'guardian' },
]

export function ViewToggle({
  active,
  className = '',
}: {
  active: 'issuer' | 'verifier' | 'analytics' | 'interactions' | 'guardian'
  className?: string
}) {
  return (
    <nav className={`flex w-full flex-wrap items-center gap-3 ${className}`}>
      <Link
        href="/"
        className="nh-glass inline-flex shrink-0 items-center gap-2 rounded-md border border-violet-200/20 px-3 py-2 shadow-[0_10px_28px_rgba(0,0,0,0.4)] transition hover:border-violet-300/40"
        aria-label="Sigil home"
      >
        <span className="grid h-6 w-6 place-items-center overflow-hidden rounded-lg border border-violet-300/45 bg-linear-to-br from-violet-500/30 to-violet-700/20">
          <SigilMark className="h-3.5 w-3.5" />
        </span>
        <span className="font-mono text-xs font-bold tracking-[0.24em] text-violet-100/95">
          SIGIL
        </span>
      </Link>

      <div className="nh-glass inline-flex flex-wrap rounded-md border border-violet-200/20 p-1 shadow-[0_10px_28px_rgba(0,0,0,0.4)]">
        {TABS.map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${
              active === tab.key
                ? 'bg-linear-to-r from-violet-500 to-fuchsia-400 text-[#1a0b2e]'
                : 'text-violet-100/80 hover:bg-violet-500/15 hover:text-violet-50'
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>
    </nav>
  )
}
