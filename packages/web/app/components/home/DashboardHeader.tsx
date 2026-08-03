import { ConnectButton } from '@rainbow-me/rainbowkit'

export function DashboardHeader({ chainId }: { chainId: number }) {
  return (
    <div className="rounded-md p-4 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-4xl font-black text-violet-50 sm:text-3xl">
            Credential Dashboard
          </h2>
          <p className="mt-1 text-sm text-violet-100/70">
            Manage issuance, revocation, and verification QR flows.
          </p>
          {chainId === 11155111 && (
            <span className="mt-2 inline-block rounded-full border border-purple-300/40 bg-purple-500/15 px-3 py-1 text-xs font-semibold text-purple-200">
              Connected to Sepolia 🟣
            </span>
          )}
        </div>
        <div className="self-start sm:self-auto">
          <ConnectButton />
        </div>
      </div>
    </div>
  )
}
