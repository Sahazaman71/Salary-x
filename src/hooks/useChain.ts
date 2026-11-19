import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPublicClient } from 'wagmi/actions'
import { formatUsdc } from '@/onchain-money'
import { config } from '@/config'
import {
  CHAIN_ID,
  PAYROLL_ADDRESS,
  STATUS,
  findExecutionTx,
  readBatch,
  readBatchPayments,
  readCompany,
  readUsdcBalance,
  verifyExecute,
} from '@/lib/chain'
import { db, newId, useTable } from '@/lib/store'
import { nowMs } from '@/lib/utils'
import type { Address, Hash } from 'viem'
import { zeroAddress } from 'viem'

export function useOnchainCompany(onchainId?: Hash) {
  const q = useQuery({
    queryKey: ['onchain-company', onchainId],
    enabled: !!PAYROLL_ADDRESS && !!onchainId,
    queryFn: async () => {
      const c = await readCompany(onchainId as Hash)
      return {
        ...c,
        registered: c.admin !== zeroAddress,
        budgetUsdc: formatUsdc(c.budget),
        reservedUsdc: formatUsdc(c.reserved),
        availableUsdc: formatUsdc(c.available),
        allowanceUsdc: formatUsdc(c.monthlyAllowance),
      }
    },
    refetchInterval: 10_000,
  })
  return q
}

export function useUsdcBalance(address?: Address) {
  return useQuery({
    queryKey: ['usdc-balance', address],
    enabled: !!address,
    queryFn: async () => formatUsdc(await readUsdcBalance(address as Address)),
    refetchInterval: 10_000,
  })
}

/**
 * Keeps local payroll status in step with the contract. The keeper executes batches
 * without the app open, so queued payrolls are checked against contract state.
 * A payroll is only marked executed after the contract reports it executed.
 */
export function usePayrollSync(companyId?: string, enabled = true) {
  const payrolls = useTable('payrolls')
  const busy = useRef(false)

  useEffect(() => {
    if (!companyId || !enabled || !PAYROLL_ADDRESS) return
    const tick = async () => {
      if (busy.current) return
      busy.current = true
      try {
        const queued = db.payrolls.where((p) => p.companyId === companyId && p.status === 'queued' && !p.demo && !!p.onchainBatchId)
        for (const p of queued) {
          const batchId = BigInt(p.onchainBatchId as string)
          const batch = await readBatch(batchId)
          if (batch.status === STATUS.Cancelled) {
            db.payrolls.update(p.id, { status: 'cancelled' })
          } else if (batch.status === STATUS.Executed) {
            await markExecuted(p.id, companyId, batchId)
          }
        }
      } catch {
        // transient RPC error: try again on the next tick
      } finally {
        busy.current = false
      }
    }
    void tick()
    const t = setInterval(() => void tick(), 15_000)
    return () => clearInterval(t)
  }, [companyId, enabled, payrolls.length])
}

async function markExecuted(payrollId: string, companyId: string, batchId: bigint) {
  const existing = db.transactions.where((t) => t.payrollId === payrollId && t.kind === 'batch_execute' && t.status === 'success')[0]
  if (!existing) {
    const created = db.transactions.where((t) => t.payrollId === payrollId && t.kind === 'batch_create' && t.status === 'success')[0]
    const found = await findExecutionTx(batchId, created?.blockNumber ? BigInt(created.blockNumber) : undefined)
    const items = db.payrollItems.where((i) => i.payrollId === payrollId)
    const payments = await readBatchPayments(batchId)
    const total = payments.reduce((a, p) => a + p.amount, 0n)
    let verified = false
    if (found) {
      const client = getPublicClient(config, { chainId: CHAIN_ID })
      const receipt = await client?.getTransactionReceipt({ hash: found.hash })
      verified = !!receipt && receipt.status === 'success' && !verifyExecute(batchId, payments.map((p) => ({ recipient: p.recipient, amount: p.amount })))(receipt)
    }
    db.transactions.insert({
      id: newId(),
      companyId,
      payrollId,
      kind: 'batch_execute',
      hash: found?.hash,
      blockNumber: found?.blockNumber.toString(),
      status: 'success',
      // Without the transaction we only have contract state, which is still onchain proof.
      verified: verified || (!found && items.length === payments.length),
      error: found ? undefined : 'Executed by the keeper. The execution transaction was not located; status confirmed from contract state.',
      amountUsdc: formatUsdc(total),
      createdBy: 'keeper',
      createdAt: nowMs(),
    })
  }
  db.payrolls.update(payrollId, { status: 'executed' })
}
