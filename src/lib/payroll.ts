import { keccak256, toBytes } from 'viem'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { db } from './store'
import { toUsdcString } from './rates'
import type { Employee, Frequency, PayrollSchedule, RateSnapshot } from './types'
import { isValidWallet } from './utils'

export const newOnchainId = (): `0x${string}` => keccak256(toBytes(`salaryx:${crypto.randomUUID()}`))
/** Opaque batch reference. Contains no personal data. */
export const refFor = (payrollId: string): `0x${string}` => keccak256(toBytes(`payroll:${payrollId}`))

/** YYYYMM in UTC. Matches the contract's period derivation. */
export function periodOf(ms: number): number {
  const d = new Date(ms)
  return d.getUTCFullYear() * 100 + d.getUTCMonth() + 1
}

export const periodLabel = (p: number) => {
  const y = Math.floor(p / 100)
  const m = p % 100
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

export function sumUsdc(values: string[]): string {
  return formatUsdc(values.reduce((acc, v) => acc + parseUsdc(v), 0n))
}

export function safeParseUsdc(v: string): bigint | undefined {
  try {
    return parseUsdc(v)
  } catch {
    return undefined
  }
}

/** Why an employee cannot be included in a payroll, or undefined if payable. */
export function payBlocker(e: Employee): string | undefined {
  if (e.status !== 'active') return 'Employee is not active'
  if (!e.wallet) return 'No wallet address'
  if (e.walletStatus !== 'approved') return 'Wallet awaiting approval'
  if (!isValidWallet(e.wallet)) return 'Invalid wallet address'
  if (!(Number(e.salaryAmount) > 0)) return 'No salary set'
  return undefined
}

export function usdcFor(e: Employee, snap: RateSnapshot): string {
  return toUsdcString(e.salaryAmount, e.currency, snap)
}

/** Has this employee already been scheduled or paid in this period for the company? */
export function alreadyInPeriod(companyId: string, period: number, employeeId: string): boolean {
  const payrolls = db.payrolls.where(
    (p) => p.companyId === companyId && p.period === period && (p.status === 'queued' || p.status === 'executed'),
  )
  const ids = new Set(payrolls.map((p) => p.id))
  return db.payrollItems.where((i) => ids.has(i.payrollId) && i.employeeId === employeeId).length > 0
}

/** Upcoming run dates for a schedule, from `from` (ms). */
export function nextRuns(s: PayrollSchedule, count: number, from = Date.now()): number[] {
  const out: number[] = []
  const d = new Date(from)
  d.setUTCHours(9, 0, 0, 0)
  const step = (f: Frequency) => {
    if (f === 'daily') d.setUTCDate(d.getUTCDate() + 1)
    else if (f === 'weekly') d.setUTCDate(d.getUTCDate() + 7)
    else d.setUTCMonth(d.getUTCMonth() + 1)
  }
  if (s.frequency === 'weekly') {
    while (d.getUTCDay() !== s.anchor || d.getTime() <= from) d.setUTCDate(d.getUTCDate() + 1)
  } else if (s.frequency === 'monthly') {
    d.setUTCDate(s.anchor)
    if (d.getTime() <= from) {
      d.setUTCMonth(d.getUTCMonth() + 1)
      d.setUTCDate(s.anchor)
    }
  } else if (d.getTime() <= from) step('daily')
  for (let i = 0; i < count; i++) {
    out.push(d.getTime())
    if (s.frequency === 'monthly') {
      d.setUTCMonth(d.getUTCMonth() + 1)
      d.setUTCDate(s.anchor)
    } else step(s.frequency)
  }
  return out
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
