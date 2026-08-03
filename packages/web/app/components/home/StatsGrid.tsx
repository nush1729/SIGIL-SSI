function StatCard({
  label,
  value,
  accent,
  valueClassName,
  compact = false,
}: {
  label: string
  value: string
  accent: string
  valueClassName?: string
  compact?: boolean
}) {
  return (
    <div
      className={` p-4 ${accent} ${compact ? 'flex h-full w-full min-w-55 max-w-full flex-col justify-center' : ''}`}
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-violet-100/70">{label}</p>
      <p className={`mt-2 text-2xl font-black ${valueClassName ?? 'text-violet-50'}`}>{value}</p>
    </div>
  )
}

export function StatsGrid({
  walletConnected,
  totalCredentials,
  activeCredentials,
  revokedCredentials,
  layout = 'grid',
}: {
  walletConnected: boolean
  totalCredentials: number
  activeCredentials: number
  revokedCredentials: number
  layout?: 'grid' | 'stack'
}) {
  const isStackLayout = layout === 'stack'

  return (
    <div
      className={
        isStackLayout
          ? 'grid h-full grid-rows-4 gap-4'
          : 'grid gap-4 sm:grid-cols-2 xl:grid-cols-4'
      }
    >
      <StatCard
        label="Wallet"
        value={walletConnected ? 'Connected' : 'Not connected'}
        accent="nh-glass"
        valueClassName={walletConnected ? 'text-emerald-300' : 'text-rose-300'}
        compact={isStackLayout}
      />
      <StatCard
        label="Total Credentials"
        value={String(totalCredentials)}
        accent="nh-glass"
        valueClassName="text-blue-400"
        compact={isStackLayout}
      />
      <StatCard
        label="Active"
        value={String(activeCredentials)}
        accent="nh-glass"
        valueClassName="text-green-400"
        compact={isStackLayout}
      />
      <StatCard
        label="Revoked"
        value={String(revokedCredentials)}
        accent="nh-glass"
        valueClassName="text-red-400"
        compact={isStackLayout}
      />
    </div>
  )
}
