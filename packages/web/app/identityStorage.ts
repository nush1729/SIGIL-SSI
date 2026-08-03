// Identity is deployed per-user (see identity.ts) — this remembers which
// Identity contract address belongs to which owner wallet, locally, since
// there is no on-chain registry mapping owner -> Identity address in this
// project's scope.
const STORAGE_PREFIX = "nh-identity-address:";

function storageKey(owner: string) {
  return `${STORAGE_PREFIX}${owner.toLowerCase()}`;
}

export function getStoredIdentityAddress(owner: string): `0x${string}` | null {
  if (typeof window === "undefined") return null;
  const value = localStorage.getItem(storageKey(owner));
  return value ? (value as `0x${string}`) : null;
}

export function storeIdentityAddress(owner: string, address: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(storageKey(owner), address);
}

export function clearStoredIdentityAddress(owner: string) {
  if (typeof window === "undefined") return;
  localStorage.removeItem(storageKey(owner));
}
