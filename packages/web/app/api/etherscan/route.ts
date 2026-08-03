import { NextResponse } from 'next/server'

const ETHERSCAN_BASE_URL = 'https://api.etherscan.io/v2/api'
const DEFAULT_DAYS = 90
const MIN_DAYS = 7
const MAX_DAYS = 120

type EtherscanTx = {
  timeStamp: string
  gasPrice: string
  input?: string
}

type EtherscanResponse<T> = {
  status: string
  message: string
  result: T[] | string
}

type ChartPoint = {
  label: string
  value: number
}

function normalizeChainId(rawChainId: string | null): number {
  if (!rawChainId) {
    return 1
  }

  const parsed = Number(rawChainId)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 1
  }

  return parsed
}

function normalizeDays(rawDays: string | null): number {
  if (!rawDays) {
    return DEFAULT_DAYS
  }

  const parsed = Number(rawDays)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_DAYS
  }

  return Math.max(MIN_DAYS, Math.min(MAX_DAYS, Math.floor(parsed)))
}

function chainLabel(chainId: number): string {
  if (chainId === 1) {
    return 'Ethereum Mainnet'
  }

  if (chainId === 11155111) {
    return 'Ethereum Sepolia'
  }

  if (chainId === 17000) {
    return 'Ethereum Holesky'
  }

  return `Chain ${chainId}`
}

function getPastDayKeys(days: number): string[] {
  const keys: string[] = []
  const now = new Date()

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(now)
    date.setDate(now.getDate() - offset)
    keys.push(date.toISOString().slice(0, 10))
  }

  return keys
}

function toDayKey(timestampSeconds: string): string {
  const timestampMs = Number(timestampSeconds) * 1000
  return new Date(timestampMs).toISOString().slice(0, 10)
}

function toGwei(rawGasPrice: string): number {
  const gasPrice = Number(rawGasPrice)

  if (!Number.isFinite(gasPrice) || gasPrice <= 0) {
    return 0
  }

  return gasPrice / 1_000_000_000
}

async function fetchEtherscan<T>(url: URL): Promise<T[]> {
  const res = await fetch(url.toString(), {
    method: 'GET',
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new Error(`Etherscan request failed with status ${res.status}`)
  }

  const payload = (await res.json()) as EtherscanResponse<T>

  if (!Array.isArray(payload.result)) {
    return []
  }

  return payload.result
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const address = searchParams.get('address')
    const chainId = normalizeChainId(searchParams.get('chainId'))
    const days = normalizeDays(searchParams.get('days'))

    if (!address) {
      return NextResponse.json({ error: 'Missing address query param.' }, { status: 400 })
    }

    const apiKey = process.env.ETHERSCAN_API_KEY ?? 'YOUR_ETHERSCAN_API_KEY'

    if (!apiKey || apiKey === 'YOUR_ETHERSCAN_API_KEY') {
      return NextResponse.json(
        {
          error:
            'ETHERSCAN_API_KEY is not configured. Add ETHERSCAN_API_KEY=YOUR_REAL_KEY in your .env.local file.',
        },
        { status: 500 }
      )
    }

    const dayKeys = getPastDayKeys(days)
    const transactionsMap = new Map<string, number>()
    const contractInteractionMap = new Map<string, number>()
    const gasPriceSumMap = new Map<string, number>()
    const gasPriceCountMap = new Map<string, number>()

    for (const key of dayKeys) {
      transactionsMap.set(key, 0)
      contractInteractionMap.set(key, 0)
      gasPriceSumMap.set(key, 0)
      gasPriceCountMap.set(key, 0)
    }

    const txUrl = new URL(ETHERSCAN_BASE_URL)
    txUrl.searchParams.set('chainid', String(chainId))
    txUrl.searchParams.set('module', 'account')
    txUrl.searchParams.set('action', 'txlist')
    txUrl.searchParams.set('address', address)
    txUrl.searchParams.set('startblock', '0')
    txUrl.searchParams.set('endblock', '99999999')
    txUrl.searchParams.set('sort', 'asc')
    txUrl.searchParams.set('apikey', apiKey)

    const transactions = await fetchEtherscan<EtherscanTx>(txUrl)

    for (const tx of transactions) {
      const dayKey = toDayKey(tx.timeStamp)
      if (!transactionsMap.has(dayKey)) {
        continue
      }

      transactionsMap.set(dayKey, (transactionsMap.get(dayKey) ?? 0) + 1)

      const gasGwei = toGwei(tx.gasPrice)
      gasPriceSumMap.set(dayKey, (gasPriceSumMap.get(dayKey) ?? 0) + gasGwei)
      gasPriceCountMap.set(dayKey, (gasPriceCountMap.get(dayKey) ?? 0) + 1)

      const isContractInteraction = Boolean(tx.input && tx.input !== '0x')
      if (isContractInteraction) {
        contractInteractionMap.set(dayKey, (contractInteractionMap.get(dayKey) ?? 0) + 1)
      }
    }

    const transactionsOverTime: ChartPoint[] = dayKeys.map((dayKey) => ({
      label: dayKey.slice(5),
      value: transactionsMap.get(dayKey) ?? 0,
    }))

    const gasPriceTrends: ChartPoint[] = dayKeys.map((dayKey) => ({
      label: dayKey.slice(5),
      value: Number(
        (
          (gasPriceSumMap.get(dayKey) ?? 0) /
          Math.max(gasPriceCountMap.get(dayKey) ?? 0, 1)
        ).toFixed(4)
      ),
    }))

    const contractInteractionCounts: ChartPoint[] = dayKeys.map((dayKey) => ({
      label: dayKey.slice(5),
      value: contractInteractionMap.get(dayKey) ?? 0,
    }))

    const totalInteractions = contractInteractionCounts.reduce(
      (sum, point) => sum + point.value,
      0
    )

    const avgGasGwei =
      gasPriceTrends.reduce((sum, point) => sum + point.value, 0) /
      gasPriceTrends.length

    return NextResponse.json({
      transactionsOverTime,
      gasPriceTrends,
      contractInteractionCounts,
      periodDays: days,
      network: {
        chainId,
        label: chainLabel(chainId),
      },
      summary: {
        txCount: transactions.length,
        interactionCount: totalInteractions,
        averageGasGwei: Number(avgGasGwei.toFixed(4)),
      },
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Failed to fetch Etherscan analytics data.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
