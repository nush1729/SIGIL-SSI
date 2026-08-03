export const runtime = 'nodejs'

import { NextResponse } from 'next/server'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildPoseidon } = require('circomlibjs')

// Called at issuance time by the issuer, to compute the Poseidon commitment
// it will anchor on-chain via NeuralHashSSI.setAgeCommitment — the step that
// binds a later ZK age proof to a credential the issuer actually attested
// to, instead of an arbitrary self-reported birth year.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const birthYear = Number(body.birthYear)
    const salt = String(body.salt ?? '')

    if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > new Date().getFullYear()) {
      return NextResponse.json({ error: 'Invalid birth year.' }, { status: 400 })
    }
    if (!salt) {
      return NextResponse.json({ error: 'Missing salt.' }, { status: 400 })
    }

    const poseidon = await buildPoseidon()
    const hash = poseidon([BigInt(birthYear), BigInt(salt)])
    const commitment = poseidon.F.toString(hash)

    return NextResponse.json({ commitment })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Commitment computation failed.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
