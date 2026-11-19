import { useState, type ReactNode } from 'react'
import { useAccount } from 'wagmi'
import { toast } from 'sonner'
import { ArrowDownToLine, ArrowUpFromLine, Building2, Clock, Play, Wallet } from 'lucide-react'
import { Button, Card, CardHeader, ConfirmDialog, EmptyState, Field, Input, Notice, PageHeader, StatCard, Td, Th } from '@/components/ui'
import { DemoBanner, PayrollStatusBadge, UsdcAmount } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { useOnchainCompany, useUsdcBalance } from '@/hooks/useChain'
import { useAuth } from '@/lib/auth'
import { executePayroll } from '@/lib/actions'
import {
  PAYROLL_ADDRESS,
  addressUrl,
  describeError,
  opDeposit,
  opRegisterCompany,
  opSetAllowance,
  opSetExecutor,
  opWithdraw,
  verifyDeposit,
  verifyEvent,
  verifyRegister,
} from '@/lib/chain'
import { useSettings } from '@/lib/settings'
import { runTx, type TxResult } from '@/lib/tx'
import { db } from '@/lib/store'
import { fmtDateTime, isValidWallet, useNow } from '@/lib/utils'
import { parseUsdc } from '@/onchain-money'
import type { Address } from 'viem'

function useAct() {
  const [busy, setBusy] = useState<string>()
  const act = async (key: string, success: string, fn: () => Promise<TxResult>) => {
    setBusy(key)
    try {
      const r = await fn()
      if (r.cancelled) toast('Cancelled')
      else if (r.ok) toast.success(r.demo ? `${success} (DEMO, nothing sent onchain)` : success)
      else toast.error(r.error ?? 'Action failed')
      return r
    } catch (e) {
      toast.error(describeError(e))
    } finally {
      setBusy(undefined)
    }
  }
  return { busy, act }
}

function parseAmt(v: string): bigint | undefined {
  try {
    const n = parseUsdc(v)
    return n > 0n ? n : undefined
  } catch {
    return undefined
  }
}

function ActionCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} subtitle={subtitle} />
      <div className="space-y-3 p-5">{children}</div>
    </Card>
  )
}

export default function Budget() {
  const { user, company, role } = useAuth()
  const d = useCompanyData()
  const { address } = useAccount()
  const { demoMode } = useSettings()
  const oc = useOnchainCompany(company?.onchainId)
  const { data: walletBalance } = useUsdcBalance(address)
  const { busy, act } = useAct()
  const now = useNow()
  const isAdmin = role === 'company_admin'
  const [dep, setDep] = useState('')
  const [wd, setWd] = useState('')
  const [wdTo, setWdTo] = useState('')
  const [allow, setAllow] = useState('')
  const [keeper, setKeeper] = useState('')
  const [confirmRun, setConfirmRun] = useState<string>()

  if (!company || !user) return null
  const registered = oc.data?.registered || demoMode
  const c = oc.data

  const missingContract = !PAYROLL_ADDRESS && !demoMode
  const depAmt = parseAmt(dep)
  const wdAmt = parseAmt(wd)
  const allowAmt = allow === '0' ? 0n : parseAmt(allow)
  const base = { companyId: company.id, user }


  const after = (r: TxResult | undefined, reset?: () => void) => {
    if (r?.ok) reset?.()
    void oc.refetch()
  }
  const doRegister = async () =>
    after(await act('register', 'Company registered', () => runTx({ ...base, kind: 'register_company', amountUsdc: '0' }, (h) => opRegisterCompany(company.onchainId, h), verifyRegister(company.onchainId))))
  const doDeposit = async () => {
    if (!depAmt) return
    after(await act('dep', 'Budget deposited', () => runTx({ ...base, kind: 'deposit', amountUsdc: dep }, (h) => opDeposit(company.onchainId, depAmt, h), verifyDeposit(company.onchainId, depAmt))), () => setDep(''))
  }
  const doAllowance = async () => {
    if (allowAmt === undefined) return
    after(await act('allow', 'Allowance updated', () => runTx({ ...base, kind: 'set_allowance', amountUsdc: allow }, (h) => opSetAllowance(company.onchainId, allowAmt, h), verifyEvent('MonthlyAllowanceSet'))), () => setAllow(''))
  }
  const doKeeper = async () =>
    after(await act('keeper', 'Keeper updated', () => runTx({ ...base, kind: 'set_executor', amountUsdc: '0' }, (h) => opSetExecutor(company.onchainId, keeper as Address, h), verifyEvent('ExecutorSet'))), () => setKeeper(''))
  const doWithdraw = async () => {
    const to = (wdTo || address) as Address
    if (!wdAmt) return
    after(await act('wd', 'Budget withdrawn', () => runTx({ ...base, kind: 'withdraw', amountUsdc: wd }, (h) => opWithdraw(company.onchainId, to, wdAmt, h), verifyEvent('BudgetWithdrawn'))), () => setWd(''))
  }
  const doRun = async () => {
    if (!runTarget) return
    after(await act('run', 'Payroll paid', () => executePayroll(user, company, runTarget)), () => setConfirmRun(undefined))
  }

  const due = d.payrolls.filter((p) => p.status === 'queued')
  const runTarget = d.payrolls.find((p) => p.id === confirmRun)

  return (
    <div className="space-y-6">
      <PageHeader title="Budget & payments" subtitle="Prefund payroll, set the monthly allowance, and release due batches" />
      {demoMode && <DemoBanner />}
      {missingContract && <Notice tone="danger" title="Contract not configured">Set VITE_PAYROLL_CONTRACT in .env and restart the dev server, or turn on demo mode in Settings.</Notice>}

      {!registered && !missingContract && (
        <Card>
          <EmptyState
            icon={Building2}
            title="Register your company onchain"
            text="This creates your company in the payroll contract and makes your connected wallet the company admin. Only an admin wallet can withdraw your budget."
            action={
              isAdmin ? (
                <Button variant="electric" loading={busy === 'register'} disabled={!address} onClick={() => void doRegister()}>
                  {address ? 'Register company' : 'Connect a wallet first'}
                </Button>
              ) : (
                <p className="text-sm text-navy-400">Ask your company admin to register the company.</p>
              )
            }
          />
        </Card>
      )}

      {registered && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard icon={Wallet} label="Prepaid budget" value={demoMode ? 'DEMO' : <UsdcAmount value={c?.budgetUsdc ?? 0} />} sub="Held by the payroll contract" />
            <StatCard icon={Clock} label="Reserved for queued payrolls" value={demoMode ? 'DEMO' : <UsdcAmount value={c?.reservedUsdc ?? 0} />} sub="Locked until paid or cancelled" />
            <StatCard icon={ArrowDownToLine} label="Available" value={demoMode ? 'DEMO' : <UsdcAmount value={c?.availableUsdc ?? 0} />} sub="Can fund new payrolls" />
            <StatCard icon={ArrowUpFromLine} label="Monthly allowance" value={demoMode ? 'DEMO' : <UsdcAmount value={c?.allowanceUsdc ?? 0} />} sub="Max queued per calendar month" />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <ActionCard title="Add budget" subtitle={`Wallet balance: ${walletBalance ?? '-'} USDC. Needs an approval, then a deposit.`}>
              <Field label="Amount (USDC)"><Input inputMode="decimal" placeholder="0.00" value={dep} onChange={(e) => setDep(e.target.value)} /></Field>
              <Button variant="electric" className="w-full" disabled={!depAmt || (!address && !demoMode)} loading={busy === 'dep'}
                onClick={() => void doDeposit()}>
                Deposit USDC
              </Button>
              <p className="text-xs text-navy-400">Need test USDC? Use "Get test USDC" in the Arc Studio sidebar.</p>
            </ActionCard>

            <ActionCard title="Monthly allowance" subtitle={isAdmin ? 'The most that can be queued for any one month. Set 0 to pause new payrolls.' : 'Only the company admin can change this.'}>
              <Field label="Allowance per month (USDC)"><Input inputMode="decimal" placeholder="e.g. 5000" value={allow} disabled={!isAdmin} onChange={(e) => setAllow(e.target.value)} /></Field>
              <Button variant="primary" className="w-full" disabled={!isAdmin || allowAmt === undefined || (!address && !demoMode)} loading={busy === 'allow'}
                onClick={() => void doAllowance()}>
                Set allowance
              </Button>
            </ActionCard>

            <ActionCard title="Automation keeper" subtitle="The wallet that releases due batches. It cannot create batches or withdraw funds.">
              <p className="text-xs text-navy-500">Current: {c && c.executor !== '0x0000000000000000000000000000000000000000' ? <a className="font-mono text-electric-600 hover:underline" href={addressUrl(c.executor)} target="_blank" rel="noopener noreferrer">{c.executor}</a> : 'none set'}</p>
              <Field label="Keeper wallet address" error={keeper && !isValidWallet(keeper) ? 'Not a valid address' : undefined}><Input className="font-mono" placeholder="0x..." value={keeper} disabled={!isAdmin} onChange={(e) => setKeeper(e.target.value)} /></Field>
              <Button variant="primary" className="w-full" disabled={!isAdmin || !isValidWallet(keeper) || (!address && !demoMode)} loading={busy === 'keeper'}
                onClick={() => void doKeeper()}>
                Set keeper
              </Button>
            </ActionCard>

            <ActionCard title="Withdraw unreserved budget" subtitle={isAdmin ? 'Admin only. Reserved funds stay locked until their batch is paid or cancelled.' : 'Only the company admin can withdraw.'}>
              <Field label="Amount (USDC)"><Input inputMode="decimal" placeholder="0.00" value={wd} disabled={!isAdmin} onChange={(e) => setWd(e.target.value)} /></Field>
              <Field label="Send to" error={wdTo && !isValidWallet(wdTo) ? 'Not a valid address' : undefined} hint="Defaults to your connected wallet"><Input className="font-mono" placeholder={address ?? '0x...'} value={wdTo} disabled={!isAdmin} onChange={(e) => setWdTo(e.target.value)} /></Field>
              <Button variant="secondary" className="w-full" disabled={!isAdmin || !wdAmt || (wdTo ? !isValidWallet(wdTo) : !address && !demoMode)} loading={busy === 'wd'}
                onClick={() => void doWithdraw()}>
                Withdraw
              </Button>
            </ActionCard>
          </div>

          <Card>
            <CardHeader title="Bulk salary payment" subtitle="Queued payrolls. The keeper releases them on their date. You can also release a due batch yourself." />
            {due.length === 0 ? (
              <EmptyState icon={Play} title="No queued payrolls" text="Approve and queue a payroll to see it here." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead><tr><Th>Payroll</Th><Th>Pay date</Th><Th>Total</Th><Th>Status</Th><Th /></tr></thead>
                  <tbody className="divide-y divide-navy-100">
                    {due.map((p) => {
                      const isDue = p.executeAfter <= now
                      return (
                        <tr key={p.id}>
                          <Td className="font-medium text-navy-900">{p.title}</Td>
                          <Td>{fmtDateTime(p.executeAfter)}</Td>
                          <Td><UsdcAmount value={p.totalUsdc} /></Td>
                          <Td><PayrollStatusBadge status={p.status} demo={p.demo} /></Td>
                          <Td className="text-right"><Button size="sm" variant={isDue ? 'electric' : 'secondary'} disabled={!isDue} onClick={() => setConfirmRun(p.id)}>{isDue ? 'Pay now' : 'Not due'}</Button></Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={!!runTarget}
        onClose={() => setConfirmRun(undefined)}
        title="Release salaries now"
        confirmLabel={demoMode ? 'Simulate payment (DEMO)' : 'Pay now'}
        loading={busy === 'run'}
        onConfirm={() => void doRun()}
      >
        <p>This sends <b>{runTarget?.totalUsdc} USDC</b> to the approved wallets in <b>{runTarget?.title}</b>. Onchain payments cannot be reversed.</p>
        {runTarget && db.payrollItems.where((i) => i.payrollId === runTarget.id).length > 0 && <p className="text-navy-400">{db.payrollItems.where((i) => i.payrollId === runTarget.id).length} recipients. Status turns to Paid only after the receipt is verified.</p>}
        {demoMode && <Notice tone="demo">Demo mode: no onchain transaction will be sent.</Notice>}
      </ConfirmDialog>
      <p className="text-xs text-navy-300">Contract: {PAYROLL_ADDRESS ? '' : 'not configured'}{PAYROLL_ADDRESS && <a className="ml-1 font-mono text-electric-600 hover:underline" href={addressUrl(PAYROLL_ADDRESS)} target="_blank" rel="noopener noreferrer">{PAYROLL_ADDRESS}</a>}</p>
    </div>
  )
}
