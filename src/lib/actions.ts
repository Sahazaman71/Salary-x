import type { Address } from 'viem'
import { parseUsdc } from '@/onchain-money'
import {
  PAYROLL_ADDRESS,
  batchIdFromReceipt,
  opCancelBatch,
  opCreateBatch,
  opExecuteBatch,
  verifyCreate,
  verifyEvent,
  verifyExecute,
} from './chain'
import { logAudit } from './audit'
import { alreadyInPeriod, payBlocker, periodOf, refFor, sumUsdc } from './payroll'
import { getSettings } from './settings'
import { db } from './store'
import { runTx, type TxResult } from './tx'
import type { Company, Payroll, Profile } from './types'

const inFlight = new Set<string>()
const MAX_BATCH = 100
const MAX_AHEAD_MS = 365 * 24 * 3600 * 1000

async function guarded(key: string, fn: () => Promise<TxResult>): Promise<TxResult> {
  if (inFlight.has(key)) return { ok: false, txId: '', error: 'This action is already in progress.' }
  inFlight.add(key)
  try {
    return await fn()
  } finally {
    inFlight.delete(key)
  }
}

/** Checks a payroll is safe to queue. Returns a list of blocking problems. */
export function validatePayroll(p: Payroll): string[] {
  const problems: string[] = []
  const items = db.payrollItems.where((i) => i.payrollId === p.id)
  if (items.length === 0) problems.push('The payroll has no employees.')
  if (items.length > MAX_BATCH) problems.push(`A batch holds at most ${MAX_BATCH} employees.`)
  if (p.executeAfter > Date.now() + MAX_AHEAD_MS) problems.push('The pay date is more than a year ahead.')
  const wallets = new Set<string>()
  for (const i of items) {
    const e = db.employees.get(i.employeeId)
    const blocker = e ? payBlocker(e) : 'Employee no longer exists'
    if (blocker) problems.push(`${e?.name ?? 'Unknown employee'}: ${blocker}`)
    if (e && e.wallet?.toLowerCase() !== i.wallet.toLowerCase()) problems.push(`${e.name}: wallet changed since this payroll was drafted`)
    if (wallets.has(i.wallet.toLowerCase())) problems.push(`Duplicate wallet in payroll: ${i.wallet}`)
    wallets.add(i.wallet.toLowerCase())
    if (alreadyInPeriod(p.companyId, p.period, i.employeeId) && !db.payrolls.get(p.id)?.onchainBatchId) {
      problems.push(`${e?.name ?? i.employeeId} is already queued or paid for this month.`)
    }
    try {
      if (parseUsdc(i.amountUsdc) <= 0n) problems.push(`${e?.name ?? 'Employee'}: amount must be above zero`)
    } catch {
      problems.push(`${e?.name ?? 'Employee'}: invalid amount`)
    }
  }
  if (items.length && sumUsdc(items.map((i) => i.amountUsdc)) !== sumUsdc([p.totalUsdc])) problems.push('Payroll total does not match its items.')
  return problems
}

export function queuePayroll(user: Profile, company: Company, payroll: Payroll): Promise<TxResult> {
  return guarded(`queue:${payroll.id}`, async () => {
    const fresh = db.payrolls.get(payroll.id)
    if (!fresh || fresh.status !== 'approved') return { ok: false, txId: '', error: 'Only an approved payroll can be queued.' }
    const problems = validatePayroll(fresh)
    if (problems.length) return { ok: false, txId: '', error: problems[0] }
    const items = db.payrollItems.where((i) => i.payrollId === fresh.id)
    const recipients = items.map((i) => i.wallet as Address)
    const amounts = items.map((i) => parseUsdc(i.amountUsdc))
    const total = amounts.reduce((a, b) => a + b, 0n)
    const demo = getSettings().demoMode
    if (!demo && !PAYROLL_ADDRESS) return { ok: false, txId: '', error: 'The payroll contract is not configured.' }

    const res = await runTx(
      { companyId: company.id, payrollId: fresh.id, kind: 'batch_create', amountUsdc: fresh.totalUsdc, user },
      (onHash) => opCreateBatch(company.onchainId, refFor(fresh.id), BigInt(Math.floor(fresh.executeAfter / 1000)), recipients, amounts, onHash),
      verifyCreate(company.onchainId, total, items.length),
    )
    if (res.ok) {
      const batchId = res.receipt ? batchIdFromReceipt(res.receipt, company.onchainId) : undefined
      db.payrolls.update(fresh.id, { status: 'queued', demo: !!res.demo, onchainBatchId: batchId?.toString(), period: periodOf(fresh.executeAfter) })
      logAudit(user, 'payroll.queued', 'payroll', `${fresh.title} queued${res.demo ? ' (DEMO)' : ''}`, company.id)
    }
    return res
  })
}

export function executePayroll(user: Profile, company: Company, payroll: Payroll): Promise<TxResult> {
  return guarded(`exec:${payroll.id}`, async () => {
    const fresh = db.payrolls.get(payroll.id)
    if (!fresh || fresh.status !== 'queued') return { ok: false, txId: '', error: 'This payroll is not queued, so it cannot be paid.' }
    if (fresh.executeAfter > Date.now()) return { ok: false, txId: '', error: 'This payroll is not due yet.' }
    const items = db.payrollItems.where((i) => i.payrollId === fresh.id)
    const expected = items.map((i) => ({ recipient: i.wallet, amount: parseUsdc(i.amountUsdc) }))
    const batchId = fresh.onchainBatchId ? BigInt(fresh.onchainBatchId) : 0n
    if (!fresh.demo && batchId === 0n) return { ok: false, txId: '', error: 'No onchain batch is linked to this payroll.' }

    const res = await runTx(
      { companyId: company.id, payrollId: fresh.id, kind: 'batch_execute', amountUsdc: fresh.totalUsdc, user },
      (onHash) => opExecuteBatch(batchId, onHash),
      verifyExecute(batchId, expected),
    )
    if (res.ok) {
      db.payrolls.update(fresh.id, { status: 'executed' })
      logAudit(user, 'payroll.executed', 'payroll', `${fresh.title} paid${res.demo ? ' (DEMO)' : ''}`, company.id)
    }
    return res
  })
}

export function cancelPayroll(user: Profile, company: Company, payroll: Payroll): Promise<TxResult> {
  return guarded(`cancel:${payroll.id}`, async () => {
    const fresh = db.payrolls.get(payroll.id)
    if (!fresh || fresh.status === 'executed' || fresh.status === 'cancelled') return { ok: false, txId: '', error: 'This payroll can no longer be cancelled.' }
    if (fresh.status !== 'queued' || fresh.demo || !fresh.onchainBatchId) {
      db.payrolls.update(fresh.id, { status: 'cancelled' })
      logAudit(user, 'payroll.cancelled', 'payroll', fresh.title, company.id)
      return { ok: true, txId: '' }
    }
    const batchId = BigInt(fresh.onchainBatchId)
    const res = await runTx(
      { companyId: company.id, payrollId: fresh.id, kind: 'batch_cancel', amountUsdc: fresh.totalUsdc, user },
      (onHash) => opCancelBatch(batchId, onHash),
      verifyEvent('BatchCancelled'),
    )
    if (res.ok) {
      db.payrolls.update(fresh.id, { status: 'cancelled' })
      logAudit(user, 'payroll.cancelled', 'payroll', fresh.title, company.id)
    }
    return res
  })
}
