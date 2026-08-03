# Sigil — Contracts

Hardhat project for the Sigil contracts. See the [root README](../../README.md)
for the full monorepo overview, setup instructions, environment variables,
and an accurate list of what's implemented vs. not.

## Scripts

| Command | Description |
|---|---|
| `pnpm compile` | Compile contracts and regenerate frontend ABI files |
| `pnpm test` | Run the Hardhat test suite (65 tests) |
| `pnpm deploy:sepolia` | Deploy the full stack to Sepolia, stake+trust the deployer, register schemas |
| `pnpm test:sepolia:live` | Live smoke test: issuance, expiry, batch, revoke, claims, attestations |
| `pnpm test:sepolia:guardian` | Live smoke test: guardian wallet, 2 full recovery rounds, guardian add/remove |
