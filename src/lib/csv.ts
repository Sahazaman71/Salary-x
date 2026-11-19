import Papa from 'papaparse'
import { z } from 'zod'
import { CURRENCIES, type Currency } from './types'
import { isValidWallet } from './utils'

const rowSchema = z.object({
  name: z.string().trim().min(1, 'name is required'),
  email: z.string().trim().email('invalid email'),
  country: z.string().trim().min(1, 'country is required'),
  wallet: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || isValidWallet(v), 'invalid wallet address'),
  salary: z
    .string()
    .trim()
    .refine((v) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0, 'salary must be a positive number'),
  currency: z.string().trim().toUpperCase().refine((v) => (CURRENCIES as readonly string[]).includes(v), 'unsupported currency'),
})

export interface ParsedEmployeeRow {
  name: string
  email: string
  country: string
  wallet?: string
  salary: string
  currency: Currency
}

export interface CsvParseResult {
  valid: ParsedEmployeeRow[]
  errors: { line: number; message: string }[]
}

export const EMPLOYEE_CSV_TEMPLATE = 'name,email,country,wallet,salary,currency\nAmina Rahman,amina@example.com,Bangladesh,,1200,USD\n'

export function parseEmployeesCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim().toLowerCase(),
  })
  const valid: ParsedEmployeeRow[] = []
  const errors: CsvParseResult['errors'] = []
  const seen = new Set<string>()
  parsed.data.forEach((raw, idx) => {
    const line = idx + 2
    const res = rowSchema.safeParse(raw)
    if (!res.success) {
      errors.push({ line, message: res.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') })
      return
    }
    const email = res.data.email.toLowerCase()
    if (seen.has(email)) {
      errors.push({ line, message: `duplicate email in file (${email})` })
      return
    }
    seen.add(email)
    valid.push({ ...res.data, email, wallet: res.data.wallet || undefined, currency: res.data.currency as Currency })
  })
  return { valid, errors }
}

export const toCsv = (rows: Record<string, string | number>[]) => Papa.unparse(rows)
