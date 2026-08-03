'use client'

import { useReadContract, useReadContracts } from 'wagmi'
import type { Abi } from 'viem'
import { schemaRegistryConfig } from '../../schemaRegistry'

const schemaRegistryAbi = schemaRegistryConfig.abi as Abi

type SchemaResult = {
  fields: readonly string[]
  version: bigint
  active: boolean
}

export function SchemaRegistrySection() {
  const { data: schemaNames, isLoading: namesLoading } = useReadContract({
    ...schemaRegistryConfig,
    functionName: 'getAllSchemaNames',
  })

  const names = (schemaNames as readonly string[] | undefined) ?? []

  const { data: schemaResults, isLoading: schemasLoading } = useReadContracts({
    contracts: names.map((name) => ({
      address: schemaRegistryConfig.address,
      abi: schemaRegistryAbi,
      functionName: 'getSchema',
      args: [name],
    })),
    query: { enabled: names.length > 0 },
  })

  const loading = namesLoading || (names.length > 0 && schemasLoading)

  return (
    <section className="nh-panel rounded-md p-5 sm:p-6">
      <h3 className="text-lg font-semibold text-violet-50">On-Chain Schema Registry</h3>
      <p className="mt-1 text-sm nh-text-muted">
        Document types and their fields, versioned and read directly from{' '}
        <code>SchemaRegistry.sol</code> — the source of truth issuers agree on, not just a
        constant baked into this app.
      </p>

      {loading && (
        <p className="mt-4 text-sm text-violet-100/70">Loading schemas from chain...</p>
      )}

      {!loading && names.length === 0 && (
        <div className="nh-glass mt-4 rounded-lg border border-dashed border-violet-400/35 p-6 text-sm text-violet-100/70">
          No schemas registered on-chain yet.
        </div>
      )}

      {!loading && names.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {names.map((name, index) => {
            const raw = schemaResults?.[index]?.result as SchemaResult | undefined
            // Guard on the actual fields, not just object truthiness: a
            // multicall entry can resolve to a partial/malformed value
            // during a transient race between the schema-names query and
            // this per-schema getSchema() batch (e.g. right after a new
            // schema is registered and the names list updates before the
            // batch has refetched to match).
            const result =
              raw && typeof raw.version === 'bigint' && Array.isArray(raw.fields) ? raw : undefined

            return (
              <div
                key={name}
                className="rounded-xl border border-violet-300/20 bg-black/20 p-3 text-sm"
              >
                <div className="flex items-center justify-between gap-2">
                  <p className="font-semibold text-violet-50">{name}</p>
                  <div className="flex items-center gap-2">
                    {result && (
                      <span className="text-xs text-violet-100/60">v{result.version.toString()}</span>
                    )}
                    {result && (
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          result.active
                            ? 'bg-emerald-500/15 text-emerald-300'
                            : 'bg-rose-500/15 text-rose-300'
                        }`}
                      >
                        {result.active ? 'Active' : 'Deprecated'}
                      </span>
                    )}
                  </div>
                </div>
                {result && (
                  <p className="mt-2 text-xs text-violet-100/70">{result.fields.join(', ')}</p>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

export default SchemaRegistrySection
