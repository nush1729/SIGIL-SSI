import { useEffect, useRef, useState } from 'react'
import type { SupportedDocumentType } from '../../documentSchemas'
import { formatFieldLabel } from '../../documentSchemas'

export function IssueCredentialSection({
  selectedDocumentType,
  documentTypeOptions,
  fieldKeys,
  extractedFields,
  selectedFieldKeys,
  recipient,
  file,
  expiryDate,
  loading,
  authenticating,
  onDocumentTypeChange,
  onFieldSelectionChange,
  onRecipientChange,
  onFileChange,
  onExpiryDateChange,
  onExtract,
  onIssue,
}: {
  selectedDocumentType: SupportedDocumentType
  documentTypeOptions: SupportedDocumentType[]
  fieldKeys: string[]
  extractedFields: Record<string, string>
  selectedFieldKeys: string[]
  recipient: string
  file: File | null
  expiryDate: string
  loading: boolean
  authenticating: boolean
  onDocumentTypeChange: (value: SupportedDocumentType) => void
  onFieldSelectionChange: (fieldKey: string, checked: boolean) => void
  onRecipientChange: (value: string) => void
  onFileChange: (value: File | null) => void
  onExpiryDateChange: (value: string) => void
  onExtract: () => void
  onIssue: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!file && fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [file])

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null)
      return
    }

    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)

    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [file])

  return (
    <section className="nh-panel rounded-md p-5 sm:p-6">
      <h3 className="text-xl font-semibold text-violet-50">Issue Credential</h3>
      <p className="mt-1 text-base nh-text-muted">
        Create a new verifiable credential and anchor it with IPFS + blockchain hash.
      </p>

      <label className="mt-5 block space-y-3">
        <span className="text-base font-semibold text-violet-100/90">Document Type</span>
        <br />
        <select
          className="nh-input w-full rounded-xl px-3 py-2.5 text-base"
          value={selectedDocumentType}
          onChange={(event) => onDocumentTypeChange(event.target.value as SupportedDocumentType)}
          disabled={loading || authenticating}
        >
          {documentTypeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>

      <div className="nh-glass mt-5 rounded-md border border-dashed border-violet-200/20 p-4">
        <p className="text-base font-semibold text-violet-100">Auto-fill from PDF</p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf"
          className="nh-input mt-3 block w-full rounded-xl px-3 py-2.5 text-base file:mr-3 file:rounded-lg file:border-0 file:bg-violet-500/20 file:px-3 file:py-1.5 file:font-semibold file:text-violet-100 hover:file:bg-violet-500/30"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        <button
          className="nh-button-secondary mt-3 w-full rounded-xl px-4 py-2.5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
          onClick={onExtract}
          disabled={loading || authenticating || !file}
        >
          {loading ? 'Extracting...' : 'Extract Data from PDF'}
        </button>

        {previewUrl && (
          <div className="mt-4 space-y-2">
            <a
              href={previewUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-base font-medium text-violet-300 underline-offset-4 hover:underline"
            >
              Preview Uploaded Document
            </a>
            <iframe
              title="Uploaded document preview"
              src={previewUrl}
              className="h-72 w-full rounded-md border border-violet-200/20 bg-black/30"
            />
          </div>
        )}
      </div>

      <label className="mt-5 block space-y-3">
        <span className="text-base font-semibold text-violet-100/90">Recipient Address (Optional)</span>
        <br />
        <input
          className="nh-input w-full rounded-xl px-3 py-2.5 font-mono text-sm"
          placeholder="0x... (defaults to your wallet)"
          value={recipient}
          onChange={(e) => onRecipientChange(e.target.value)}
        />
      </label>

      <label className="mt-5 block space-y-3">
        <span className="text-base font-semibold text-violet-100/90">Expires On (Optional)</span>
        <br />
        <input
          type="date"
          className="nh-input w-full rounded-xl px-3 py-2.5 text-base"
          value={expiryDate}
          onChange={(e) => onExpiryDateChange(e.target.value)}
        />
        <span className="block text-sm nh-text-muted">
          Leave blank for a credential that never expires. Verifiers checking this credential
          on-chain will see it as invalid automatically once this date passes.
        </span>
      </label>

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {fieldKeys.map((fieldKey) => (
          <label key={fieldKey} className="space-y-3">
            <span className="flex items-center gap-2 text-base font-semibold text-violet-100/90">
              <input
                type="checkbox"
                className="h-4 w-4 accent-violet-400"
                checked={selectedFieldKeys.includes(fieldKey)}
                onChange={(event) => onFieldSelectionChange(fieldKey, event.target.checked)}
              />
              <span>{formatFieldLabel(fieldKey)}</span>
            </span>
            <input
              className="nh-input w-full rounded-xl px-3 py-2.5 text-base text-violet-50/95"
              placeholder={formatFieldLabel(fieldKey)}
              value={extractedFields[fieldKey] ?? ''}
              readOnly
              aria-readonly
            />
          </label>
        ))}
      </div>

      <p className="mt-3 text-sm text-violet-100/70">
        Extracted data fields are read-only. Use checkboxes to choose what goes into the credential.
      </p>

      <button
        className="nh-button-primary mt-5 rounded-xl px-5 py-2.5 text-base font-semibold transition disabled:cursor-not-allowed disabled:opacity-60"
        onClick={onIssue}
        disabled={loading || authenticating}
      >
        {authenticating ? 'Authenticating...' : loading ? 'Processing...' : 'Issue Credential'}
      </button>
    </section>
  )
}
