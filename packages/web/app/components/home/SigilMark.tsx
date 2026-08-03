export function SigilMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} role="img" aria-label="Sigil mark">
      <defs>
        <linearGradient id="sigil-mark-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="100%" stopColor="#d946ef" />
        </linearGradient>
      </defs>
      <path
        d="M20 4 L34 12 L34 28 L20 36 L6 28 L6 12 Z"
        fill="none"
        stroke="url(#sigil-mark-stroke)"
        strokeWidth="2.6"
        strokeLinejoin="round"
      />
      <path
        d="M13 20 L18 25 L28 14"
        fill="none"
        stroke="#f5f3ff"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default SigilMark
