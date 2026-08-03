'use client'

import { useEffect, useMemo, useState } from 'react'

type ChartPoint = {
  label: string
  value: number
}

type AnalyticsResponse = {
  transactionsOverTime: ChartPoint[]
  gasPriceTrends: ChartPoint[]
  contractInteractionCounts: ChartPoint[]
  periodDays?: number
  network?: {
    chainId: number
    label: string
  }
  summary: {
    txCount: number
    interactionCount: number
    averageGasGwei: number
  }
  error?: string
}

type PeriodOption = 7 | 30 | 90

const PERIOD_OPTIONS: PeriodOption[] = [7, 30, 90]

function formatCompact(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1)}M`
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`
  }

  if (value >= 1) {
    return value.toFixed(0)
  }

  return value.toFixed(2)
}

function getXAxisTicks(points: ChartPoint[]): number[] {
  if (points.length <= 1) {
    return [0]
  }

  const tickCount = 6
  const ticks: number[] = []

  for (let index = 0; index < tickCount; index += 1) {
    const ratio = index / (tickCount - 1)
    ticks.push(Math.round(ratio * (points.length - 1)))
  }

  return [...new Set(ticks)]
}

function takeLast(points: ChartPoint[], period: PeriodOption): ChartPoint[] {
  if (points.length <= period) {
    return points
  }

  return points.slice(points.length - period)
}

function sumValues(points: ChartPoint[]): number {
  return points.reduce((sum, point) => sum + point.value, 0)
}

function LineChart({ points }: { points: ChartPoint[] }) {
  const maxValue = useMemo(() => Math.max(...points.map((point) => point.value), 1), [points])

  const chartPoints = useMemo(() => {
    if (points.length === 0) {
      return ''
    }

    return points
      .map((point, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
        const y = 92 - (point.value / maxValue) * 84
        return `${x},${y}`
      })
      .join(' ')
  }, [maxValue, points])

  const areaPoints = `0,92 ${chartPoints} 100,92`
  const xTicks = getXAxisTicks(points)
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-md border border-violet-200/16 bg-black/20 p-3">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        {yTicks.map((tick) => {
          const y = 92 - tick * 84
          return (
            <line
              key={`line-${tick}`}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke="rgba(167, 139, 250, 0.14)"
              strokeWidth="0.4"
            />
          )
        })}

        <polygon points={areaPoints} fill="rgba(139, 92, 246, 0.16)" />
        <polyline fill="none" stroke="rgba(167,139,250,0.95)" strokeWidth="1.6" points={chartPoints} />

        {points.map((point, index) => {
          const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
          const y = 92 - (point.value / maxValue) * 84
          return <circle key={`${point.label}-${index}`} cx={x} cy={y} r="0.8" fill="rgba(196,181,253,0.95)" />
        })}
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-between text-[10px] text-violet-100/65">
        {xTicks.map((index) => (
          <span key={`line-x-${index}`}>{points[index]?.label}</span>
        ))}
      </div>

      <div className="pointer-events-none absolute right-2 top-2 flex h-[calc(100%-24px)] flex-col justify-between text-[10px] text-violet-100/55">
        {[maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0].map((value, index) => (
          <span key={`line-y-${index}`}>{formatCompact(value)}</span>
        ))}
      </div>
    </div>
  )
}

function AreaChart({ points }: { points: ChartPoint[] }) {
  const maxValue = useMemo(() => Math.max(...points.map((point) => point.value), 1), [points])

  const chartPoints = useMemo(() => {
    if (points.length === 0) {
      return ''
    }

    return points
      .map((point, index) => {
        const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100
        const y = 92 - (point.value / maxValue) * 84
        return `${x},${y}`
      })
      .join(' ')
  }, [maxValue, points])

  const areaPoints = `0,92 ${chartPoints} 100,92`
  const xTicks = getXAxisTicks(points)

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-md border border-violet-200/16 bg-black/20 p-3">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
        <defs>
          <linearGradient id="gasAreaGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(167, 139, 250, 0.75)" />
            <stop offset="100%" stopColor="rgba(139, 92, 246, 0.06)" />
          </linearGradient>
        </defs>

        <polygon points={areaPoints} fill="url(#gasAreaGradient)" />
        <polyline fill="none" stroke="rgba(167,139,250,0.95)" strokeWidth="1.8" points={chartPoints} />
      </svg>

      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-between text-[10px] text-violet-100/65">
        {xTicks.map((index) => (
          <span key={`gas-x-${index}`}>{points[index]?.label}</span>
        ))}
      </div>

      <div className="pointer-events-none absolute right-2 top-2 flex h-[calc(100%-24px)] flex-col justify-between text-[10px] text-violet-100/55">
        {[maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0].map((value, index) => (
          <span key={`gas-y-${index}`}>{formatCompact(value)}</span>
        ))}
      </div>
    </div>
  )
}

function BarChart({ points }: { points: ChartPoint[] }) {
  const maxValue = useMemo(() => {
    if (points.length === 0) {
      return 1
    }

    return Math.max(...points.map((point) => point.value), 1)
  }, [points])

  const xTicks = getXAxisTicks(points)
  const yTicks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-md border border-violet-200/16 bg-black/20 p-3">
      <div className="absolute inset-3">
        {yTicks.map((tick) => (
          <div
            key={`bar-grid-${tick}`}
            className="absolute left-0 right-0 border-t border-violet-200/10"
            style={{ bottom: `${tick * 84 + 8}%` }}
          />
        ))}
      </div>

      <div className="relative flex h-[calc(100%-18px)] items-end gap-1.5">
        {points.map((point) => (
          <div key={point.label} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
            <div
              className="w-full rounded-t-sm bg-linear-to-t from-violet-600/85 to-violet-300/90"
              style={{ height: `${Math.max((point.value / maxValue) * 84, point.value > 0 ? 2 : 0)}%` }}
              title={`${point.label}: ${point.value.toFixed(2)}`}
            />
          </div>
        ))}
      </div>

      <div className="pointer-events-none absolute bottom-2 left-2 right-2 flex justify-between text-[10px] text-violet-100/65">
        {xTicks.map((index) => (
          <span key={`bar-x-${index}`}>{points[index]?.label}</span>
        ))}
      </div>

      <div className="pointer-events-none absolute right-2 top-2 flex h-[calc(100%-24px)] flex-col justify-between text-[10px] text-violet-100/55">
        {[maxValue, maxValue * 0.75, maxValue * 0.5, maxValue * 0.25, 0].map((value, index) => (
          <span key={`bar-y-${index}`}>{formatCompact(value)}</span>
        ))}
      </div>
    </div>
  )
}

function DonutChart({ ratio }: { ratio: number }) {
  const clamped = Math.max(0, Math.min(1, ratio))
  const radius = 40
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - clamped)

  return (
    <div className="flex items-center justify-center rounded-md border border-violet-200/16 bg-black/20 p-3">
      <div className="relative h-32 w-32">
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <circle cx="50" cy="50" r={radius} fill="none" stroke="rgba(167, 139, 250, 0.18)" strokeWidth="10" />
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="none"
            stroke="rgba(167, 139, 250, 0.95)"
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-lg font-semibold text-violet-50">{(clamped * 100).toFixed(1)}%</span>
          <span className="text-[10px] text-violet-100/70">interaction ratio</span>
        </div>
      </div>
    </div>
  )
}

function PeriodSelector({
  value,
  onChange,
}: {
  value: PeriodOption
  onChange: (next: PeriodOption) => void
}) {
  return (
    <div className="inline-flex rounded-md border border-violet-200/18 bg-black/20 p-1">
      {PERIOD_OPTIONS.map((period) => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          className={`rounded-sm px-2.5 py-1 text-xs font-semibold transition ${
            value === period
              ? 'bg-violet-500/25 text-violet-50'
              : 'text-violet-100/70 hover:bg-violet-400/10'
          }`}
        >
          {period}D
        </button>
      ))}
    </div>
  )
}

export function BlockchainAnalyticsSection({ address, chainId }: { address: string; chainId: number }) {
  const [data, setData] = useState<AnalyticsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [txPeriod, setTxPeriod] = useState<PeriodOption>(30)
  const [gasPeriod, setGasPeriod] = useState<PeriodOption>(30)
  const [contractPeriod, setContractPeriod] = useState<PeriodOption>(30)

  useEffect(() => {
    let isMounted = true

    async function fetchAnalytics() {
      try {
        setLoading(true)
        setError(null)

        const response = await fetch(`/api/etherscan?address=${address}&chainId=${chainId}&days=90`, {
          method: 'GET',
          cache: 'no-store',
        })

        const payload = (await response.json()) as AnalyticsResponse

        if (!response.ok || payload.error) {
          throw new Error(payload.error ?? 'Failed to load Etherscan analytics.')
        }

        if (isMounted) {
          setData(payload)
        }
      } catch (fetchError) {
        const message = fetchError instanceof Error ? fetchError.message : 'Unable to load analytics.'
        if (isMounted) {
          setError(message)
          setData(null)
        }
      } finally {
        if (isMounted) {
          setLoading(false)
        }
      }
    }

    fetchAnalytics()

    return () => {
      isMounted = false
    }
  }, [address, chainId])

  const txSeries = useMemo(() => {
    if (!data) {
      return []
    }

    return takeLast(data.transactionsOverTime, txPeriod)
  }, [data, txPeriod])

  const gasSeries = useMemo(() => {
    if (!data) {
      return []
    }

    return takeLast(data.gasPriceTrends, gasPeriod)
  }, [data, gasPeriod])

  const contractSeries = useMemo(() => {
    if (!data) {
      return []
    }

    return takeLast(data.contractInteractionCounts, contractPeriod)
  }, [data, contractPeriod])

  const txSeriesForContract = useMemo(() => {
    if (!data) {
      return []
    }

    return takeLast(data.transactionsOverTime, contractPeriod)
  }, [data, contractPeriod])

  const contractTotal = useMemo(() => sumValues(contractSeries), [contractSeries])
  const txTotalForContract = useMemo(() => sumValues(txSeriesForContract), [txSeriesForContract])

  const interactionRatio = useMemo(() => {
    if (txTotalForContract <= 0) {
      return 0
    }

    return contractTotal / txTotalForContract
  }, [contractTotal, txTotalForContract])

  const gasAverageForPeriod = useMemo(() => {
    if (gasSeries.length === 0) {
      return 0
    }

    return sumValues(gasSeries) / gasSeries.length
  }, [gasSeries])

  const txTotalForSummary = useMemo(() => {
    return sumValues(txSeries)
  }, [txSeries])

  const hasAnyData = useMemo(() => {
    if (!data) {
      return false
    }

    return (
      data.summary.txCount > 0 ||
      data.transactionsOverTime.some((point) => point.value > 0) ||
      data.gasPriceTrends.some((point) => point.value > 0) ||
      data.contractInteractionCounts.some((point) => point.value > 0)
    )
  }, [data])

  return (
    <section className="nh-panel rounded-md p-5 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-violet-50">On-chain Analytics</h3>
          <p className="mt-1 text-sm nh-text-muted">
            Powered by Etherscan data for wallet {address.slice(0, 6)}...{address.slice(-4)}
            {data?.network?.label ? ` on ${data.network.label}` : ''}
          </p>
        </div>
        {data?.summary ? (
          <p className="text-xs text-violet-100/80">
            {txTotalForSummary.toFixed(0)} tx ({txPeriod}d) • {contractTotal.toFixed(0)} contract interactions ({contractPeriod}d) • {gasAverageForPeriod.toFixed(2)} avg gas ({gasPeriod}d)
          </p>
        ) : null}
      </div>

      {loading ? <p className="mt-4 text-sm text-violet-100/80">Loading analytics charts...</p> : null}
      {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}

      {!loading && !error && data && hasAnyData ? (
        <div className="mt-5 grid gap-5 xl:grid-cols-3">
          <div className="nh-glass rounded-md p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-h-13">
                <p className="text-sm font-semibold text-violet-50">Transactions over time</p>
                <p className="mt-1 text-xs nh-text-muted">Daily count over selectable period</p>
              </div>
              <PeriodSelector value={txPeriod} onChange={setTxPeriod} />
            </div>

            <div className="mt-3">
              <LineChart points={txSeries} />
            </div>
          </div>

          <div className="nh-glass rounded-md p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-h-13">
                <p className="text-sm font-semibold text-violet-50">Gas price trends</p>
                <p className="mt-1 text-xs nh-text-muted">Average gas price over selectable period</p>
              </div>
              <PeriodSelector value={gasPeriod} onChange={setGasPeriod} />
            </div>

            <div className="mt-3">
              <AreaChart points={gasSeries} />
            </div>
            <p className="mt-2 text-xs text-violet-100/80">{gasAverageForPeriod.toFixed(2)} gwei average in last {gasPeriod} days</p>
          </div>

          <div className="nh-glass rounded-md p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-h-13">
                <p className="text-sm font-semibold text-violet-50">Contract information</p>
                <p className="mt-1 text-xs nh-text-muted">Interaction count + ratio over selectable period</p>
              </div>
              <PeriodSelector value={contractPeriod} onChange={setContractPeriod} />
            </div>

            <div className="mt-3 grid h-56 gap-3 sm:grid-cols-2">
              <DonutChart ratio={interactionRatio} />
              <div className="rounded-md border border-violet-200/16 bg-black/20 p-3 text-xs text-violet-100/80">
                <p>{contractTotal.toFixed(0)} contract interactions</p>
                <p className="mt-1">{txTotalForContract.toFixed(0)} total tx in last {contractPeriod} days</p>
                <p className="mt-1">{(interactionRatio * 100).toFixed(1)}% of transactions were contract calls</p>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {!loading && !error && data && !hasAnyData ? (
        <div className="mt-5 rounded-md border border-violet-200/16 bg-black/20 p-5">
          <p className="text-sm font-semibold text-violet-100">No recent activity found for this wallet on the selected chain.</p>
          <p className="mt-1 text-xs nh-text-muted">
            Try switching wallet network (for example Sepolia/Mainnet) or use an address with recent transactions.
          </p>
        </div>
      ) : null}
    </section>
  )
}
