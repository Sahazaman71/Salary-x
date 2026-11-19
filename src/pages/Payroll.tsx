import { useState } from 'react'
import { toast } from 'sonner'
import { Ban, Check, Eye, ListChecks, Send } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, Field, Input, Notice, PageHeader, Td, Th } from '@/components/ui'
import { DemoBanner, EstimateNotice, PayrollStatusBadge, UsdcAmount } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { useOnchainCompany } from '@/hooks/useChain'
import { useAuth } from '@/lib/auth'
import { cancelPayroll, queuePayroll, validatePayroll } from '@/lib/actions'
import { logAudit } from '@/lib/audit'
import { alreadyInPeriod, payBlocker, periodLabel, periodOf, safeParseUsdc, sumUsdc, usdcFor } from '@/lib/payroll'
import { convert, useRates } from '@/lib/rates'
import { useSettings } from '@/lib/settings'
import { db, newId } from '@/lib/store'
import type { Payroll as PayrollRow } from '@/lib/types'
import { cn, fmtDateTime, fmtMoney, shortAddress, nowMs, useNow } from '@/lib/utils'
import { describeError } from '@/lib/chain'

const toLocalInput = (ms: number) => {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000)
  return d.toISOString().slice(0, 16)
}
const nextMonthFirst = () => {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 9, 0).getTime()
}

export default function Payroll() {
  const { user, company } = useAuth()
  const d = useCompanyData()
  const { demoMode } = useSettings()
  const { data: rates } = useRates()
  const oc = useOnchainCompany(company?.onchainId)
  const cur = company?.defaultCurrency ?? 'USD'

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(toLocalInput(nextMonthFirst()))
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [detail, setDetail] = useState<PayrollRow>()
  const [approving, setApproving] = useState<PayrollRow>()
  const [queuing, setQueuing] = useState<PayrollRow>()
  const [cancelling, setCancelling] = useState<PayrollRow>()
  const [busy, setBusy] = useState(false)

  const now = useNow()
  const when = new Date(date).getTime()
  const period = Number.isFinite(when) ? periodOf(when) : 0
  const rows =
      d.employees.map((e) => {
        const blocker = payBlocker(e) ?? (period && alreadyInPeriod(e.companyId, period, e.id) ? 'Already queued or paid this month' : undefined)
        const amount = amounts[e.id] ?? (rates ? usdcFor(e, rates) : '0')
        return { e, blocker, amount, on: !blocker && (picked[e.id] ?? true) }
      })
  const chosen = rows.filter((r) => r.on)
  const invalid = chosen.filter((r) => { const v = safeParseUsdc(r.amount); return v === undefined || v <= 0n })
  const total = invalid.length ? '0' : sumUsdc(chosen.map((r) => r.amount))
  const dateOk = Number.isFinite(when) && when < now + 365 * 86400000
  const canCreate = chosen.length > 0 && chosen.length <= 100 && invalid.length === 0 && dateOk && !!rates

  const createDraft = () => {
    if (!company || !user || !rates) return
    const id = newId()
    db.payrolls.insert({
      id, companyId: company.id, title: title.trim() || `Salary ${periodLabel(period)}`, period, executeAfter: when,
      status: 'draft', totalUsdc: total, demo: false, createdBy: user.id, createdAt: nowMs(),
    })
    chosen.forEach((r) =>
      db.payrollItems.insert({
        id: newId(), payrollId: id, employeeId: r.e.id, wallet: r.e.wallet as string, amountUsdc: r.amount,
        displayAmount: String(Math.round(convert(Number(r.amount), 'USD', r.e.currency, rates) * 100) / 100), displayCurrency: r.e.currency,
      }),
    )
    logAudit(user, 'payroll.drafted', 'payroll', `${chosen.length} employees, ${total} USDC`, company.id)
    toast.success('Draft created. Review it, then approve.')
    setTitle(''); setPicked({}); setAmounts({})
  }

  const approve = () => {
    if (!approving || !user || !company) return
    const problems = validatePayroll(approving)
    if (problems.length) { toast.error(problems[0]); return }
    db.payrolls.update(approving.id, { status: 'approved' })
    logAudit(user, 'payroll.approved', 'payroll', `${approving.title}: ${approving.totalUsdc} USDC`, company.id)
    toast.success('Payroll approved')
    setApproving(undefined)
  }

  const queue = async () => {
    if (!queuing || !user || !company) return
    setBusy(true)
    try {
      const r = await queuePayroll(user, company, queuing)
      if (r.ok) { toast.success(r.demo ? 'Queued (DEMO, nothing sent onchain)' : 'Payroll queued onchain. It will be paid on its date.'); setQueuing(undefined) }
      else if (r.cancelled) toast('Cancelled')
      else toast.error(r.error ?? 'Could not queue payroll')
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const cancel = async () => {
    if (!cancelling || !user || !company) return
    setBusy(true)
    try {
      const r = await cancelPayroll(user, company, cancelling)
      if (r.ok) { toast.success('Payroll cancelled'); setCancelling(undefined) }
      else if (!r.cancelled) toast.error(r.error ?? 'Could not cancel')
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const detailItems = detail ? db.payrollItems.where((i) => i.payrollId === detail.id) : []
  const available = Number(oc.data?.availableUsdc ?? 0)
  const shortfall = queuing && !demoMode && Number(queuing.totalUsdc) > available

  return (
    <div className="space-y-6">
      <PageHeader title="Payroll" subtitle="Draft, review, approve, then queue onchain from your prepaid budget" />
      {demoMode && <DemoBanner />}

      <Card>
        <CardHeader title="New payroll" subtitle="Pick who is paid and on which date. Each wallet can be paid once per calendar month." />
        <div className="space-y-5 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title"><Input placeholder={`Salary ${period ? periodLabel(period) : ''}`} value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Pay date" error={!dateOk ? 'Choose a date within the next year' : undefined} hint="The keeper releases the batch on or after this time. Month is derived in UTC."><Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>

          {d.employees.length === 0 ? (
            <EmptyState icon={ListChecks} title="No employees to pay" text="Add employees with approved wallets first." />
          ) : (
            <div className="overflow-x-auto rounded-xl border border-navy-100">
              <table className="w-full">
                <thead className="bg-navy-50"><tr><Th /><Th>Employee</Th><Th>Wallet</Th><Th>Salary</Th><Th>Pay (USDC)</Th></tr></thead>
                <tbody className="divide-y divide-navy-100">
                  {rows.map((r) => (
                    <tr key={r.e.id} className={cn(r.blocker && 'bg-navy-50/50 text-navy-300')}>
                      <Td><input type="checkbox" className="h-5 w-5 accent-electric-500" aria-label={`Include ${r.e.name}`} disabled={!!r.blocker} checked={r.on} onChange={(ev) => setPicked({ ...picked, [r.e.id]: ev.target.checked })} /></Td>
                      <Td><p className="font-medium text-navy-900">{r.e.name}</p>{r.blocker && <p className="text-xs text-amber-700">{r.blocker}</p>}</Td>
                      <Td className="font-mono text-xs">{shortAddress(r.e.wallet) || '-'}</Td>
                      <Td className="num">{fmtMoney(r.e.salaryAmount, r.e.currency)}</Td>
                      <Td><Input className="h-9 w-32 num" inputMode="decimal" disabled={!!r.blocker} value={r.amount} onChange={(ev) => setAmounts({ ...amounts, [r.e.id]: ev.target.value })} aria-label={`USDC amount for ${r.e.name}`} /></Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <EstimateNotice />
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-navy-900 p-5 text-white">
            <div>
              <p className="text-xs text-navy-300">Total payroll ({chosen.length} employees)</p>
              <p className="num font-display text-3xl font-semibold">{total} <span className="text-lg text-electric-300">USDC</span></p>
              {rates && <p className="mt-0.5 text-xs text-navy-300">About {fmtMoney(convert(Number(total), 'USD', cur, rates), cur)} (estimate)</p>}
            </div>
            <Button variant="electric" size="lg" disabled={!canCreate} onClick={createDraft}>Create draft</Button>
          </div>
          {invalid.length > 0 && <Notice tone="danger">Fix the amount for: {invalid.map((r) => r.e.name).join(', ')}. Use a positive number with up to 6 decimals.</Notice>}
        </div>
      </Card>

      <Card>
        <CardHeader title="Payrolls" />
        {d.payrolls.length === 0 ? (
          <EmptyState icon={ListChecks} title="No payrolls yet" text="Create a draft above to get started." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Title</Th><Th>Pay date</Th><Th>Total</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-navy-100">
                {d.payrolls.map((p) => (
                  <tr key={p.id} className="hover:bg-navy-50/60">
                    <Td className="font-medium text-navy-900">{p.title}</Td>
                    <Td>{fmtDateTime(p.executeAfter)}</Td>
                    <Td><UsdcAmount value={p.totalUsdc} /></Td>
                    <Td><PayrollStatusBadge status={p.status} demo={p.demo} /></Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" icon={Eye} onClick={() => setDetail(p)}>View</Button>
                        {p.status === 'draft' && <Button size="sm" variant="secondary" icon={Check} onClick={() => setApproving(p)}>Approve</Button>}
                        {p.status === 'approved' && <Button size="sm" variant="electric" icon={Send} onClick={() => setQueuing(p)}>Queue</Button>}
                        {(p.status === 'draft' || p.status === 'approved' || p.status === 'queued') && <Button size="sm" variant="ghost" icon={Ban} onClick={() => setCancelling(p)}>Cancel</Button>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Dialog open={!!detail} onClose={() => setDetail(undefined)} title={detail?.title ?? ''} wide>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2"><PayrollStatusBadge status={detail?.status ?? 'draft'} demo={detail?.demo} /><Badge>{detail ? periodLabel(detail.period) : ''}</Badge><span className="text-sm text-navy-400">{detail && fmtDateTime(detail.executeAfter)}</span></div>
          <div className="max-h-80 overflow-y-auto rounded-xl border border-navy-100">
            <table className="w-full"><tbody className="divide-y divide-navy-100">
              {detailItems.map((i) => (
                <tr key={i.id}><Td>{d.employees.find((e) => e.id === i.employeeId)?.name ?? 'Removed employee'}</Td><Td className="font-mono text-xs">{shortAddress(i.wallet)}</Td><Td className="text-right"><UsdcAmount value={i.amountUsdc} /></Td></tr>
              ))}
            </tbody></table>
          </div>
          <p className="text-right text-sm font-medium">Total <UsdcAmount value={detail?.totalUsdc ?? 0} /></p>
        </div>
      </Dialog>

      <ConfirmDialog open={!!approving} onClose={() => setApproving(undefined)} onConfirm={approve} title="Approve payroll" confirmLabel="Approve">
        <p>Approve <b>{approving?.title}</b> for <b>{approving?.totalUsdc} USDC</b>? You will still confirm and sign before anything is sent onchain.</p>
      </ConfirmDialog>

      <ConfirmDialog open={!!queuing} onClose={() => setQueuing(undefined)} onConfirm={() => void queue()} loading={busy} title="Queue payroll onchain" confirmLabel={demoMode ? 'Queue (DEMO)' : 'Sign and queue'}>
        <p>This reserves <b>{queuing?.totalUsdc} USDC</b> from your prepaid budget for <b>{queuing && fmtDateTime(queuing.executeAfter)}</b>. After that date the keeper pays the approved wallets. You can cancel until it is paid.</p>
        {shortfall && <Notice tone="danger" title="Not enough unreserved budget">Available: {available} USDC. Add budget first on the Budget page.</Notice>}
        {demoMode && <Notice tone="demo">Demo mode: nothing is sent onchain and the result is labelled DEMO.</Notice>}
      </ConfirmDialog>

      <ConfirmDialog open={!!cancelling} onClose={() => setCancelling(undefined)} onConfirm={() => void cancel()} loading={busy} danger title="Cancel payroll" confirmLabel="Cancel payroll">
        <p>Cancel <b>{cancelling?.title}</b>? {cancelling?.status === 'queued' && !cancelling.demo ? 'This sends a transaction that releases the reserved budget.' : 'Nothing has been reserved yet.'}</p>
      </ConfirmDialog>
    </div>
  )
}
