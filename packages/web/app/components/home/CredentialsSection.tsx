import { useEffect, useMemo, useState } from 'react'
import { QRCodeCanvas } from 'qrcode.react'
import type { Credential } from './types'
import { authenticateWithBiometric } from '../../biometricAuth'
import { useToast } from '../ui/ToastProvider'

function CredentialCard({
  credential,
  address,
  revokingCredentialHash,
  authenticatingCredentialHash,
  onRevoke,
  onViewQr,
  onViewPdf,
  isViewingPdf,
}: {
  credential: Credential
  address: `0x${string}`
  revokingCredentialHash: `0x${string}` | null
  authenticatingCredentialHash: `0x${string}` | null
  onRevoke: (credentialHash: `0x${string}`) => void
  onViewQr: (credential: Credential) => void
  onViewPdf: (credential: Credential) => void
  isViewingPdf: boolean
}) {
  const isProcessing = revokingCredentialHash === credential.credentialHash
  const isAuthenticating = authenticatingCredentialHash === credential.credentialHash

  return (
    <article className="nh-glass flex h-full min-w-0 flex-col rounded-md border border-violet-200/20 p-5">
      <div className="min-w-0 space-y-2 text-sm text-violet-100/85">
        <p>
          <span className="font-semibold text-violet-50">IPFS CID:</span>{' '}
          <a
            href={`https://gateway.pinata.cloud/ipfs/${credential.ipfsCID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all wrap-anywhere font-medium text-violet-300 underline-offset-4 hover:underline"
          >
            {credential.ipfsCID}
          </a>
        </p>

        <p>
          <span className="font-semibold text-violet-50">Pinata Gateway:</span>{' '}
          <a
            href={`https://gateway.pinata.cloud/ipfs/${credential.ipfsCID}`}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all wrap-anywhere font-medium text-violet-300 underline-offset-4 hover:underline"
          >
            Open on Pinata Gateway
          </a>
        </p>

        <p>
          <span className="font-semibold text-violet-50">Issuer:</span>{' '}
          <span className="break-all wrap-anywhere">{credential.issuer}</span>
        </p>

        <p>
          <span className="font-semibold text-violet-50">Status:</span>{' '}
          <span
            className={
              credential.isValid
                ? 'text-emerald-300 font-semibold'
                : 'text-rose-300 font-semibold'
            }
          >
            {credential.isValid ? 'Active' : 'Revoked'}
          </span>
        </p>

        <p>
          <span className="font-semibold text-violet-50">Issued At:</span>{' '}
          {new Date(Number(credential.issuedAt) * 1000).toLocaleString()}
        </p>

        <p>
          <span className="font-semibold text-violet-50">Hash:</span>{' '}
          <span className="break-all wrap-anywhere">{credential.credentialHash}</span>
        </p>
      </div>

      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold"
          onClick={() => onViewQr(credential)}
        >
          View QR
        </button>

        <button
          type="button"
          className="nh-button-secondary rounded-xl px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
          onClick={() => onViewPdf(credential)}
          disabled={isViewingPdf}
        >
          {isViewingPdf ? 'Authenticating...' : 'View PDF'}
        </button>

        {credential.isValid && credential.issuer === address && (
          <button
            className="rounded-xl border border-rose-300/30 bg-rose-500/20 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:bg-rose-500/30 disabled:cursor-not-allowed disabled:opacity-60"
            onClick={() => onRevoke(credential.credentialHash)}
            disabled={Boolean(revokingCredentialHash) || Boolean(authenticatingCredentialHash)}
          >
            {isProcessing ? 'Processing...' : isAuthenticating ? 'Authenticating...' : 'Revoke Credential'}
          </button>
        )}
      </div>
    </article>
  )
}

export function CredentialsSection({
  credentials,
  address,
  revokingCredentialHash,
  authenticatingCredentialHash,
  onRevoke,
}: {
  credentials: Credential[]
  address: `0x${string}`
  revokingCredentialHash: `0x${string}` | null
  authenticatingCredentialHash: `0x${string}` | null
  onRevoke: (credentialHash: `0x${string}`) => void
}) {
  const [currentSlide, setCurrentSlide] = useState(0)
  const [qrCredential, setQrCredential] = useState<Credential | null>(null)
  const [viewingPdfHash, setViewingPdfHash] = useState<`0x${string}` | null>(null)
  const toast = useToast()

  const sortedCredentials = useMemo(() => {
    return [...credentials].sort((a, b) => {
      if (a.issuedAt === b.issuedAt) {
        return 0
      }

      return a.issuedAt > b.issuedAt ? -1 : 1
    })
  }, [credentials])

  const selfIssuedCount = useMemo(
    () => credentials.filter((credential) => credential.issuer === address).length,
    [credentials, address]
  )

  const receivedFromOthersCount = credentials.length - selfIssuedCount

  const credentialSlides = useMemo(() => {
    const pageSize = 3
    const slides: Credential[][] = []

    for (let index = 0; index < sortedCredentials.length; index += pageSize) {
      slides.push(sortedCredentials.slice(index, index + pageSize))
    }

    return slides
  }, [sortedCredentials])

  useEffect(() => {
    if (credentialSlides.length === 0) {
      setCurrentSlide(0)
      return
    }

    if (currentSlide > credentialSlides.length - 1) {
      setCurrentSlide(credentialSlides.length - 1)
    }
  }, [credentialSlides, currentSlide])

  const canGoPrevious = currentSlide > 0
  const canGoNext = currentSlide < credentialSlides.length - 1
  const qrValue =
    typeof window !== 'undefined' && qrCredential
      ? `${window.location.origin}/verify?user=${address}&hash=${qrCredential.credentialHash}`
      : ''

  async function handleViewPdf(credential: Credential) {
    if (viewingPdfHash) {
      return
    }

    try {
      setViewingPdfHash(credential.credentialHash)

      const biometricResult = await authenticateWithBiometric(address)
      if (!biometricResult.ok) {
        toast.error(biometricResult.message)
        return
      }

      const metadataUrl = `https://gateway.pinata.cloud/ipfs/${credential.ipfsCID}`
      const metadataResponse = await fetch(metadataUrl, { cache: 'no-store' })

      if (!metadataResponse.ok) {
        throw new Error('Unable to read credential metadata from Pinata.')
      }

      const metadata = (await metadataResponse.json()) as {
        documentCid?: string
        pdfCid?: string
        fileCid?: string
        credential?: {
          documentCid?: string
          pdfCid?: string
          fileCid?: string
        }
        credentials?: Array<{
          documentCid?: string
          credential?: {
            documentCid?: string
          }
        }>
      }

      const documentCidFromBatch = metadata.credentials?.find(
        (entry) => entry.credential?.documentCid || entry.documentCid
      )

      const documentCid =
        metadata.documentCid ??
        metadata.pdfCid ??
        metadata.fileCid ??
        metadata.credential?.documentCid ??
        metadata.credential?.pdfCid ??
        metadata.credential?.fileCid ??
        documentCidFromBatch?.credential?.documentCid ??
        documentCidFromBatch?.documentCid

      if (!documentCid) {
        throw new Error('No PDF link found for this credential.')
      }

      const documentUrl = `https://gateway.pinata.cloud/ipfs/${documentCid}`
      const opened = window.open(documentUrl, '_blank', 'noopener,noreferrer')

      if (!opened) {
        toast.info('Popup was blocked. Please allow popups and try again.')
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to open PDF.')
    } finally {
      setViewingPdfHash(null)
    }
  }

  return (
    <section className="nh-panel rounded-md p-5 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold text-violet-50">Wallet Credentials</h3>
        <span className="rounded-full border border-violet-300/25 bg-violet-500/10 px-3 py-1 text-xs font-semibold text-violet-200">
          Total: {credentials.length}
        </span>
      </div>
      <p className="mt-1 text-sm nh-text-muted">
        Includes credentials issued by you and credentials issued to your wallet by others.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full border border-violet-300/25 bg-black/25 px-3 py-1 font-semibold text-violet-100/90">
          Self-issued: {selfIssuedCount}
        </span>
        <span className="rounded-full border border-violet-300/25 bg-black/25 px-3 py-1 font-semibold text-violet-100/90">
          Received from others: {receivedFromOthersCount}
        </span>
      </div>

      {credentials.length === 0 && (
        <div className="nh-glass mt-5 rounded-md border border-dashed border-violet-200/20 p-6 text-sm text-violet-100/70">
          No credentials found for this wallet.
        </div>
      )}

      {credentialSlides.length > 0 && (
        <div className="mt-5 space-y-4">
          <div className="overflow-hidden">
            <div
              className="flex transition-transform duration-300 ease-out"
              style={{ transform: `translateX(-${currentSlide * 100}%)` }}
            >
              {credentialSlides.map((slide, slideIndex) => (
                <div key={slideIndex} className="grid w-full shrink-0 gap-4 md:grid-cols-3">
                  {slide.map((credential, cardIndex) => (
                    <CredentialCard
                      key={`${credential.credentialHash}-${cardIndex}`}
                      credential={credential}
                      address={address}
                      revokingCredentialHash={revokingCredentialHash}
                      authenticatingCredentialHash={authenticatingCredentialHash}
                      onRevoke={onRevoke}
                      onViewQr={setQrCredential}
                      onViewPdf={handleViewPdf}
                      isViewingPdf={viewingPdfHash === credential.credentialHash}
                    />
                  ))}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between">
            <p className="text-xs text-violet-100/70">
              Slide {currentSlide + 1} of {credentialSlides.length}
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setCurrentSlide((value) => Math.max(value - 1, 0))}
                disabled={!canGoPrevious}
                className="nh-button-secondary rounded-xl px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setCurrentSlide((value) => Math.min(value + 1, credentialSlides.length - 1))}
                disabled={!canGoNext}
                className="nh-button-secondary rounded-xl px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {qrCredential && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="nh-panel w-full max-w-sm rounded-md p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="text-sm font-semibold uppercase tracking-wide text-violet-100/80">
                Credential QR
              </p>
              <button
                type="button"
                className="nh-button-secondary rounded-xl px-3 py-1.5 text-xs font-semibold"
                onClick={() => setQrCredential(null)}
              >
                Close
              </button>
            </div>

            <p className="mb-4 break-all wrap-anywhere text-xs text-violet-100/70">
              Hash: {qrCredential.credentialHash}
            </p>

            <div className="mx-auto w-fit rounded-lg bg-white p-3">
              <QRCodeCanvas value={qrValue} size={220} />
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
