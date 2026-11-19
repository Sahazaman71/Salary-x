import { getPublicClient } from 'wagmi/actions'
import type { Hash, TransactionReceipt } from 'viem'
import { config } from '@/config'
import { logAudit } from './audit'
import { CHAIN_ID, describeError, isUserRejection, PAYROLL_ADDRESS, type Verifier } from './chain'
import { getSettings } from './settings'
import { db, newId } from './store'
import type { PaymentTransaction, Profile, TxKind } from './types'

export interface TxMeta {
  companyId: string
  payrollId?: string
  kind: TxKind
  amountUsdc: string
  user: Profile
}

export interface TxResult {
  ok: boolean
  demo?: boolean
  cancelled?: boolean
  txId: string
  receipt?: TransactionReceipt
  error?: string
}

/**
 * Runs one onchain action and records it. A transaction is only marked `success`
 * after its receipt confirmed AND the emitted events matched what was requested.
 */
export async function runTx(
  meta: TxMeta,
  op: (onHash: (h: Hash) => void) => Promise<TransactionReceipt>,
  verify: Verifier,
): Promise<TxResult> {
  const id = newId()
  const base: PaymentTransaction = {
    id,
    companyId: meta.companyId,
    payrollId: meta.payrollId,
    kind: meta.kind,
    status: 'pending',
    amountUsdc: meta.amountUsdc,
    verified: false,
    createdBy: meta.user.id,
    createdAt: Date.now(),
  }

  if (getSettings().demoMode) {
    db.transactions.insert({ ...base, status: 'demo' })
    logAudit(meta.user, `${meta.kind}.demo`, 'transaction', `DEMO ${meta.kind} of ${meta.amountUsdc} USDC (no onchain transaction)`, meta.companyId)
    return { ok: true, demo: true, txId: id }
  }

  db.transactions.insert(base)
  try {
    const receipt = await op((hash) => db.transactions.update(id, { hash }))
    db.transactions.update(id, { blockNumber: receipt.blockNumber.toString() })
    if (receipt.status !== 'success') {
      db.transactions.update(id, { status: 'failed', error: 'Transaction reverted onchain.' })
      logAudit(meta.user, `${meta.kind}.failed`, 'transaction', 'Reverted onchain', meta.companyId)
      return { ok: false, txId: id, receipt, error: 'Transaction reverted onchain.' }
    }
    const mismatch = verify(receipt)
    if (mismatch) {
      db.transactions.update(id, { status: 'failed', error: `Not verified: ${mismatch}` })
      logAudit(meta.user, `${meta.kind}.unverified`, 'transaction', mismatch, meta.companyId)
      return { ok: false, txId: id, receipt, error: mismatch }
    }
    db.transactions.update(id, { status: 'success', verified: true })
    logAudit(meta.user, `${meta.kind}.success`, 'transaction', `${meta.amountUsdc} USDC confirmed`, meta.companyId)
    return { ok: true, txId: id, receipt }
  } catch (e) {
    if (isUserRejection(e)) {
      db.transactions.remove(id)
      return { ok: false, cancelled: true, txId: id, error: describeError(e) }
    }
    const message = describeError(e)
    const row = db.transactions.get(id)
    if (row?.hash) {
      // Submitted but not confirmed yet: keep it pending so it can be re-checked.
      db.transactions.update(id, { status: 'pending', error: message })
    } else {
      db.transactions.update(id, { status: 'failed', error: message })
      logAudit(meta.user, `${meta.kind}.failed`, 'transaction', message, meta.companyId)
    }
    return { ok: false, txId: id, error: message }
  }
}

/** Re-check a pending transaction by its hash. */
export async function recheckTx(tx: PaymentTransaction): Promise<'success' | 'failed' | 'pending'> {
  if (!tx.hash) return 'pending'
  const client = getPublicClient(config, { chainId: CHAIN_ID })
  if (!client) return 'pending'
  try {
    const receipt = await client.getTransactionReceipt({ hash: tx.hash as Hash })
    if (receipt.status !== 'success') {
      db.transactions.update(tx.id, { status: 'failed', error: 'Transaction reverted onchain.', blockNumber: receipt.blockNumber.toString() })
      return 'failed'
    }
    const fromContract = receipt.logs.some((l) => l.address.toLowerCase() === PAYROLL_ADDRESS?.toLowerCase())
    db.transactions.update(tx.id, {
      status: 'success',
      verified: fromContract,
      error: undefined,
      blockNumber: receipt.blockNumber.toString(),
    })
    return 'success'
  } catch {
    return 'pending'
  }
}
