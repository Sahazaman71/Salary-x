import { useQuery } from '@tanstack/react-query'
import { getJson, setJson } from './store'
import { CURRENCIES, type Currency, type RateSnapshot } from './types'

/**
 * Exchange rates are display estimates only. Settlement is always USDC on Arc,
 * and USDC is treated as 1 USD for these estimates.
 */
const RATES_URL = 'https://open.er-api.com/v6/latest/USD'
const TTL_MS = 6 * 60 * 60 * 1000

/** Last-resort approximations, clearly labelled as fallback in the UI. */
const FALLBACK: Record<Currency, number> = { USD: 1, EUR: 0.92, GBP: 0.79, BDT: 120, INR: 83, PHP: 57, AUD: 1.52 }

export async function fetchRates(): Promise<RateSnapshot> {
  const cached = getJson<RateSnapshot>('rates')
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return { ...cached, source: 'cached' }
  try {
    const res = await fetch(RATES_URL)
    if (!res.ok) throw new Error(`rates ${res.status}`)
    const json = (await res.json()) as { rates?: Record<string, number> }
    const rates = {} as Record<Currency, number>
    for (const c of CURRENCIES) {
      const v = json.rates?.[c]
      if (typeof v !== 'number' || !(v > 0)) throw new Error(`missing rate ${c}`)
      rates[c] = v
    }
    const snap: RateSnapshot = { base: 'USD', rates, fetchedAt: Date.now(), source: 'live' }
    setJson('rates', snap)
    return snap
  } catch {
    if (cached) return { ...cached, source: 'cached' }
    return { base: 'USD', rates: FALLBACK, fetchedAt: 0, source: 'fallback' }
  }
}

export function useRates() {
  return useQuery({ queryKey: ['rates'], queryFn: fetchRates, staleTime: 30 * 60 * 1000 })
}

/** Convert between two display currencies (estimate). */
export function convert(amount: number, from: Currency, to: Currency, snap: RateSnapshot): number {
  if (from === to) return amount
  return (amount / snap.rates[from]) * snap.rates[to]
}

/** Salary entered in `currency` expressed as a USDC decimal string (6 dp). USD maps 1:1. */
export function toUsdcString(amount: string, currency: Currency, snap: RateSnapshot): string {
  const n = Number(amount)
  if (!Number.isFinite(n) || n < 0) return '0'
  if (currency === 'USD') return amount
  return (n / snap.rates[currency]).toFixed(6).replace(/\.?0+$/, '') || '0'
}

export function rateLabel(snap: RateSnapshot | undefined): string {
  if (!snap) return 'Loading rates'
  if (snap.source === 'fallback') return 'Offline estimate (rates unavailable)'
  return `Rates updated ${new Date(snap.fetchedAt).toLocaleString()}`
}
