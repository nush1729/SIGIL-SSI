import { NextResponse } from 'next/server'

type PinataResponse = {
  IpfsHash: string
}

function getPinataHeaders(): Record<string, string> {
  const jwt = process.env.PINATA_JWT
  const apiKey = process.env.PINATA_API_KEY ?? process.env.NEXT_PUBLIC_PINATA_KEY
  const apiSecret =
    process.env.PINATA_SECRET_API_KEY ?? process.env.NEXT_PUBLIC_PINATA_SECRET

  if (jwt) {
    return { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' }
  }

  if (apiKey && apiSecret) {
    return {
      pinata_api_key: apiKey,
      pinata_secret_api_key: apiSecret,
      'Content-Type': 'application/json',
    }
  }

  throw new Error(
    'Pinata auth is missing. Set PINATA_JWT or PINATA_API_KEY + PINATA_SECRET_API_KEY in env.'
  )
}

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const headers = getPinataHeaders()

    const pinataRes = await fetch('https://api.pinata.cloud/pinning/pinJSONToIPFS', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      cache: 'no-store',
    })

    const payload = await pinataRes.json().catch(() => ({}))

    if (!pinataRes.ok) {
      const message =
        pinataRes.status === 401
          ? 'Pinata unauthorized (401). Verify your PINATA credentials.'
          : 'Failed to upload JSON to IPFS.'

      return NextResponse.json(
        { error: message, details: payload },
        { status: pinataRes.status }
      )
    }

    const cid = (payload as PinataResponse).IpfsHash
    return NextResponse.json({ cid })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Unexpected error while uploading JSON to IPFS.'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
