export function HeroSigil({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 420 420"
      className={className}
      role="img"
      aria-label="Sigil emblem — a sealed credential mark"
    >
      <defs>
        <linearGradient id="sigil-stroke" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#c4b5fd" />
          <stop offset="55%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#d946ef" />
        </linearGradient>
        <radialGradient id="sigil-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
        </radialGradient>
        <filter id="sigil-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <circle cx="210" cy="210" r="190" fill="url(#sigil-glow)" />

      {/* stacked credential documents, receding behind the seal */}
      <g opacity="0.55" stroke="#c4b5fd" strokeWidth="1.6" fill="none">
        <rect x="96" y="86" width="150" height="196" rx="10" transform="rotate(-8 171 184)" />
        <rect x="112" y="78" width="150" height="196" rx="10" transform="rotate(-2 187 176)" />
      </g>
      <g opacity="0.85" stroke="#e9d5ff" strokeWidth="1.8" fill="none">
        <rect x="128" y="74" width="150" height="196" rx="10" />
        <line x1="150" y1="108" x2="234" y2="108" />
        <line x1="150" y1="128" x2="234" y2="128" />
        <line x1="150" y1="148" x2="210" y2="148" />
      </g>

      {/* the sigil seal itself */}
      <g filter="url(#sigil-blur)" opacity="0.9">
        <path
          d="M270 156 L330 190 L330 258 L270 292 L210 258 L210 190 Z"
          fill="none"
          stroke="url(#sigil-stroke)"
          strokeWidth="10"
        />
      </g>
      <path
        d="M270 156 L330 190 L330 258 L270 292 L210 258 L210 190 Z"
        fill="rgba(13, 5, 24, 0.65)"
        stroke="url(#sigil-stroke)"
        strokeWidth="4.5"
        strokeLinejoin="round"
      />

      {/* checkmark: a verified, sealed credential */}
      <path
        d="M240 224 L262 246 L302 200"
        fill="none"
        stroke="#f5f3ff"
        strokeWidth="9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* accent sparks */}
      <circle cx="98" cy="300" r="3.5" fill="#e9d5ff" opacity="0.8" />
      <circle cx="336" cy="120" r="2.5" fill="#f0abfc" opacity="0.75" />
      <circle cx="356" cy="270" r="3" fill="#c4b5fd" opacity="0.7" />
    </svg>
  )
}

export default HeroSigil
