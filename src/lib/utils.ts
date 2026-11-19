import { useEffect, useState } from 'react'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { isAddress } from 'viem'

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs))

/** Current time in ms. Kept in one place so components never call Date.now() while rendering. */
export const nowMs = () => Date.now()

/** A clock that re-renders its component every `everyMs`. Use for "is this due yet" checks. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(nowMs)
  useEffect(() => {
    const t = setInterval(() => setNow(nowMs()), everyMs)
    return () => clearInterval(t)
  }, [everyMs])
  return now
}

export const shortAddress = (a?: string) => (a ? `${a.slice(0, 6)}...${a.slice(-4)}` : '')
export const shortHash = (h?: string) => (h ? `${h.slice(0, 10)}...${h.slice(-6)}` : '')

export const isValidWallet = (a?: string): a is `0x${string}` => !!a && isAddress(a, { strict: false })

export const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
export const fmtDateTime = (ms: number) =>
  new Date(ms).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

export const fmtMoney = (value: number | string, currency = 'USD') => {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '-'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(n)
}

export const fmtUsdc = (value: number | string) => {
  const n = typeof value === 'string' ? Number(value) : value
  if (!Number.isFinite(n)) return '-'
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} USDC`
}

export function downloadFile(name: string, content: BlobPart, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export const COUNTRIES = [
  'United States', 'United Kingdom', 'Germany', 'France', 'Spain', 'Italy', 'Netherlands', 'Ireland',
  'Bangladesh', 'India', 'Philippines', 'Australia', 'Canada', 'Singapore', 'United Arab Emirates',
  'Brazil', 'Mexico', 'Nigeria', 'Kenya', 'South Africa', 'Pakistan', 'Vietnam', 'Indonesia', 'Japan',
] as const

export const COUNTRY_CURRENCY: Record<string, string> = {
  'United States': 'USD', 'United Kingdom': 'GBP', Germany: 'EUR', France: 'EUR', Spain: 'EUR', Italy: 'EUR',
  Netherlands: 'EUR', Ireland: 'EUR', Bangladesh: 'BDT', India: 'INR', Philippines: 'PHP', Australia: 'AUD',
}
