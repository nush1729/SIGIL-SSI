export const DOCUMENT_SCHEMAS = {
  '10th Marksheet': [
    'student_name',
    'board_name',
    'roll_number',
    'year_of_passing',
  ],
  '12th Marksheet': [
    'student_name',
    'board_name',
    'roll_number',
    'stream',
  ],
  Aadhaar: [
    'full_name',
    'aadhaar_number',
    'date_of_birth',
    'gender',
    'address',
  ],
  Passport: [
    'full_name',
    'passport_number',
    'nationality',
    'date_of_birth',
    'date_of_expiry',
  ],
  PAN: [
    'full_name',
    'pan_number',
    'date_of_birth',
    'father_name',
  ],
  'Voter ID': [
    'full_name',
    'voter_id_number',
    'gender',
    'address',
  ],
  'Driving License': [
    'full_name',
    'license_number',
    'date_of_birth',
    'date_of_expiry',
    'vehicle_class',
  ],
  'UG Marksheet': [
    'student_name',
    'university_name',
    'registration_number',
    'course_name',
    'cgpa_or_percentage',
  ],
  'PG Marksheet': [
    'student_name',
    'university_name',
    'registration_number',
    'course_name',
    'cgpa_or_percentage',
  ],
  'Diploma Certificate': [
    'student_name',
    'institute_name',
    'certificate_number',
    'course_name',
    'year_of_passing',
  ],
} as const

export type SupportedDocumentType = keyof typeof DOCUMENT_SCHEMAS

export const DOCUMENT_TYPE_OPTIONS = Object.keys(DOCUMENT_SCHEMAS) as SupportedDocumentType[]

export function formatFieldLabel(fieldKey: string): string {
  return fieldKey
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

export function normalizeDocumentType(rawType: string): SupportedDocumentType | null {
  const normalized = rawType.trim().toLowerCase().replace(/[^a-z0-9]/g, '')

  if (!normalized) {
    return null
  }

  if (normalized.includes('10th') || normalized.includes('secondary')) {
    return '10th Marksheet'
  }

  if (normalized.includes('12th') || normalized.includes('highersecondary')) {
    return '12th Marksheet'
  }

  if (normalized.includes('aadhaar') || normalized.includes('aadhar')) {
    return 'Aadhaar'
  }

  if (normalized.includes('passport')) {
    return 'Passport'
  }

  if (normalized === 'pan' || normalized.includes('pancard')) {
    return 'PAN'
  }

  if (normalized.includes('voter')) {
    return 'Voter ID'
  }

  if (normalized.includes('drivinglicense') || normalized.includes('dl')) {
    return 'Driving License'
  }

  if (normalized.includes('ug') || normalized.includes('bachelor')) {
    return 'UG Marksheet'
  }

  if (normalized.includes('pg') || normalized.includes('master')) {
    return 'PG Marksheet'
  }

  if (normalized.includes('diploma')) {
    return 'Diploma Certificate'
  }

  const exactMatch = DOCUMENT_TYPE_OPTIONS.find(
    (docType) => docType.toLowerCase().replace(/[^a-z0-9]/g, '') === normalized
  )

  return exactMatch ?? null
}
