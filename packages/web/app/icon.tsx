import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #1b0f33, #3b0a3f)',
          borderRadius: 8,
        }}
      >
        <svg width="22" height="22" viewBox="0 0 40 40">
          <path
            d="M20 4 L34 12 L34 28 L20 36 L6 28 L6 12 Z"
            fill="none"
            stroke="#d8b4fe"
            strokeWidth="3"
            strokeLinejoin="round"
          />
          <path
            d="M13 20 L18 25 L28 14"
            fill="none"
            stroke="#f5f3ff"
            strokeWidth="3.2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    ),
    { ...size }
  )
}
