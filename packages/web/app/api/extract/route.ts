export const runtime = 'nodejs'

import { GoogleGenerativeAI } from '@google/generative-ai'
import { NextResponse } from 'next/server'
import { DOCUMENT_SCHEMAS } from '../../documentSchemas'

const schemaInstructions = Object.entries(DOCUMENT_SCHEMAS)
  .map(([docType, fields]) => `- ${docType}: ${fields.join(', ')}`)
  .join('\n')

const EXTRACTION_PROMPT = `
You are a strict document classifier and extractor.
Identify the document type from this exact list and extract corresponding fields.

Allowed document types and fields:
${schemaInstructions}

Rules:
1) Choose exactly one documentType from the allowed list.
2) Extract only the fields defined for the chosen type.
3) If a field is missing, keep it as empty string.
4) Return ONLY valid JSON and no markdown.

Output JSON shape:
{
  "documentType": "",
  "fields": {
    "field_key": "value"
  }
}
`

export async function POST(req: Request) {
  try {
    const formData = await req.formData()
    const file = formData.get('file')
    const apiKey = process.env.GEMINI_API_KEY

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 })
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: 'GEMINI_API_KEY is not configured.' },
        { status: 500 }
      )
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const base64File = buffer.toString('base64')

    const genAI = new GoogleGenerativeAI(apiKey)
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' })

    let result

    try {
      result = await model.generateContent({
        contents: [
          {
            role: 'user',
            parts: [
              { text: EXTRACTION_PROMPT },
              {
                inlineData: {
                  mimeType: file.type || 'application/pdf',
                  data: base64File,
                },
              },
            ],
          },
        ],
      })
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Extraction failed'
      const lowerMessage = message.toLowerCase()

      if (lowerMessage.includes('429') || lowerMessage.includes('quota')) {
        const retryMatch = message.match(/retry in\s*([\d.]+)s/i)
        const retryAfterSeconds = retryMatch ? Math.ceil(Number(retryMatch[1])) : null

        return NextResponse.json(
          {
            error:
              retryAfterSeconds && Number.isFinite(retryAfterSeconds)
                ? `Gemini quota exceeded. Please retry after ${retryAfterSeconds}s or upgrade your API plan.`
                : 'Gemini quota exceeded. Please retry later or upgrade your API plan.',
            code: 'QUOTA_EXCEEDED',
            retryAfterSeconds,
          },
          { status: 429 }
        )
      }

      throw error
    }

    let text = result.response.text().trim()
    if (text.startsWith('```')) {
      text = text.replace(/```json|```/g, '').trim()
    }

    const parsed = JSON.parse(text) as {
      documentType?: string
      fields?: Record<string, string>
    }

    return NextResponse.json({ data: parsed })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Extraction failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
