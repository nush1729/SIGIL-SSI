type BiometricAuthResult =
  | { ok: true }
  | { ok: false; message: string }

const BIOMETRIC_CREDENTIAL_KEY = 'nh-biometric-credential-id'

function getCredentialStorageKey(userHint: string) {
  return `${BIOMETRIC_CREDENTIAL_KEY}:${(userHint || 'default').toLowerCase()}`
}

function createChallenge() {
  return crypto.getRandomValues(new Uint8Array(32))
}

function toBase64Url(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

function hasUserVerification(authenticatorData: ArrayBuffer) {
  const bytes = new Uint8Array(authenticatorData)
  if (bytes.length < 33) {
    return false
  }

  const flags = bytes[32]
  return (flags & 0x04) !== 0
}

export async function authenticateWithBiometric(userHint: string): Promise<BiometricAuthResult> {
  if (typeof PublicKeyCredential === 'undefined' || !navigator.credentials) {
    return { ok: false, message: 'Biometric authentication is not supported on this browser/device.' }
  }

  try {
    const canUsePlatformAuthenticator =
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()

    if (!canUsePlatformAuthenticator) {
      return { ok: false, message: 'No platform biometric authenticator is available on this device.' }
    }

    const storageKey = getCredentialStorageKey(userHint)
    let credentialId = localStorage.getItem(storageKey)

    if (!credentialId) {
      const registration = await navigator.credentials.create({
        publicKey: {
          challenge: createChallenge(),
          rp: { name: 'Sigil' },
          user: {
            id: new TextEncoder().encode(userHint || 'sigil-user'),
            name: userHint || 'user@sigil.local',
            displayName: 'Sigil User',
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: 'platform',
            userVerification: 'required',
            residentKey: 'preferred',
          },
          timeout: 60000,
          attestation: 'none',
        },
      })

      if (!(registration instanceof PublicKeyCredential)) {
        return { ok: false, message: 'Failed to initialize biometric authentication.' }
      }

      credentialId = toBase64Url(registration.rawId)
      localStorage.setItem(storageKey, credentialId)
    }

    const assertion = await navigator.credentials.get({
      mediation: 'required',
      publicKey: {
        challenge: createChallenge(),
        allowCredentials: [
          {
            type: 'public-key',
            id: fromBase64Url(credentialId),
            transports: ['internal'],
          },
        ],
        rpId: window.location.hostname,
        userVerification: 'required',
        timeout: 60000,
      },
    })

    if (!assertion) {
      return { ok: false, message: 'Biometric authentication was cancelled.' }
    }

    if (!(assertion instanceof PublicKeyCredential)) {
      return { ok: false, message: 'Unexpected credential response during biometric authentication.' }
    }

    const assertionResponse = assertion.response
    if (!(assertionResponse instanceof AuthenticatorAssertionResponse)) {
      return { ok: false, message: 'Invalid biometric assertion response.' }
    }

    if (!hasUserVerification(assertionResponse.authenticatorData)) {
      return { ok: false, message: 'Biometric user verification was not satisfied.' }
    }

    return { ok: true }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'InvalidStateError') {
      localStorage.removeItem(getCredentialStorageKey(userHint))
      return { ok: false, message: 'Biometric profile reset. Please retry biometric auth.' }
    }

    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return { ok: false, message: 'Biometric authentication was cancelled or timed out.' }
    }

    return { ok: false, message: 'Biometric authentication failed.' }
  }
}
