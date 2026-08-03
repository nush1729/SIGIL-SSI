// Client-side ZK proof generation for the age-over-18 predicate. Runs
// entirely in the browser (witness generation + Groth16 proving via
// snarkjs, fetching the circuit artifacts from /public/zk/) so the birth
// year never leaves the holder's device — closing the disclosed privacy
// trade-off of generating proofs server-side.
//
// snarkjs is loaded via a plain <script> tag pointing at its prebuilt
// browser IIFE bundle (public/zk/snarkjs.min.js), not a module import.
// snarkjs's npm package internals do Node-style dynamic file resolution
// that Turbopack's build-time asset tracer cannot handle even when the
// import is only ever reached client-side (NftJsonAsset panic) — loading
// the same file Node never sees as a runtime <script> sidesteps that
// entirely, and is the approach snarkjs's own docs recommend for browser use.
export type AgeProofResult = {
  pA: [string, string]
  pB: [[string, string], [string, string]]
  pC: [string, string]
  pubSignals: [string, string]
}

type SnarkjsGlobal = {
  groth16: {
    fullProve: (
      input: Record<string, unknown>,
      wasmUrl: string,
      zkeyUrl: string
    ) => Promise<{ proof: unknown; publicSignals: unknown }>
    exportSolidityCallData: (proof: unknown, publicSignals: unknown) => Promise<string>
  }
}

declare global {
  interface Window {
    snarkjs?: SnarkjsGlobal
  }
}

const WASM_URL = '/zk/AgeOver18.wasm'
const ZKEY_URL = '/zk/AgeOver18_final.zkey'
const SNARKJS_SCRIPT_URL = '/zk/snarkjs.min.js'

let snarkjsLoadPromise: Promise<SnarkjsGlobal> | null = null

function loadSnarkjs(): Promise<SnarkjsGlobal> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('ZK proof generation only runs in the browser.'))
  }
  if (window.snarkjs) {
    return Promise.resolve(window.snarkjs)
  }
  if (snarkjsLoadPromise) {
    return snarkjsLoadPromise
  }

  snarkjsLoadPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SNARKJS_SCRIPT_URL}"]`)
    const script = existing ?? document.createElement('script')

    script.onload = () => {
      if (window.snarkjs) {
        resolve(window.snarkjs)
      } else {
        reject(new Error('snarkjs script loaded but did not attach to window.'))
      }
    }
    script.onerror = () => reject(new Error('Failed to load snarkjs.'))

    if (!existing) {
      script.src = SNARKJS_SCRIPT_URL
      document.head.appendChild(script)
    } else if (window.snarkjs) {
      resolve(window.snarkjs)
    }
  })

  return snarkjsLoadPromise
}

export async function computeAgeCommitment(birthYear: number, salt: string): Promise<string> {
  const { buildPoseidon } = await import('circomlibjs')
  const poseidon = await buildPoseidon()
  const hash = poseidon([BigInt(birthYear), BigInt(salt)])
  return poseidon.F.toString(hash)
}

export async function generateAgeProof(
  birthYear: number,
  salt: string,
  currentYear: number = new Date().getFullYear()
): Promise<AgeProofResult> {
  if (!Number.isInteger(birthYear) || birthYear < 1900 || birthYear > currentYear) {
    throw new Error('Invalid birth year.')
  }

  const [snarkjs, commitment] = await Promise.all([loadSnarkjs(), computeAgeCommitment(birthYear, salt)])

  let proof, publicSignals
  try {
    ;({ proof, publicSignals } = await snarkjs.groth16.fullProve(
      { birthYear, salt, commitment, currentYear },
      WASM_URL,
      ZKEY_URL
    ))
  } catch {
    throw new Error('Could not generate a proof for this birth year — you must be at least 18.')
  }

  const calldata = await snarkjs.groth16.exportSolidityCallData(proof, publicSignals)
  const [pA, pB, pC, pubSignals] = JSON.parse(`[${calldata}]`)

  return { pA, pB, pC, pubSignals }
}
