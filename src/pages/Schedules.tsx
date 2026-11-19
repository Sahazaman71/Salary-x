import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarClock, Plus, Power, Trash2, Zap } from 'lucide-react'
import { Badge, Button, Card, CardHeader, ConfirmDialog, Dialog, EmptyState, Field, Input, Notice, PageHeader, Select } from '@/components/ui'
import { DemoBanner, UsdcAmount } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { useOnchainCompany } from '@/hooks/useChain'
import { useAuth } from '@/lib/auth'
import { queuePayroll } from '@/lib/actions'
import { logAudit } from '@/lib/audit'
import { alreadyInPeriod, nextRuns, payBlocker, periodLabel, periodOf, sumUsdc, usdcFor, WEEKDAYS } from '@/lib/payroll'
import { toUsdcString, useRates } from '@/lib/rates'
import { useSettings } from '@/lib/settings'
import { db, newId } from '@/lib/store'
import type { Company, Frequency, PayrollSchedule, Profile, RateSnapshot } from '@/lib/types'
import { fmtDateTime, nowMs } from '@/lib/utils'
import { describeError } from '@/lib/chain'

const daysUntil = (ms: number) => Math.ceil((ms - nowMs()) / 86400000)

function prepare(s: PayrollSchedule, runMs: number, company: Company, user: Profile, rates: RateSnapshot, approved: boolean) {
  const period = periodOf(runMs)
  const emps = db.employees.where((e) => e.companyId === company.id && (s.employeeIds.length === 0 || s.employeeIds.includes(e.id)))
  const payable = emps.filter((e) => !payBlocker(e) && !alreadyInPeriod(company.id, period, e.id))
  if (payable.length === 0) return undefined
  const amounts = payable.map((e) => usdcFor(e, rates))
  const id = newId()
  const payroll = db.payrolls.insert({
    id, companyId: company.id, title: `${s.name} - ${periodLabel(period)}`, period, executeAfter: runMs,
    status: approved ? 'approved' : 'draft', totalUsdc: sumUsdc(amounts), demo: false, scheduleId: s.id, createdBy: user.id, createdAt: nowMs(),
  })
  payable.forEach((e, i) =>
    db.payrollItems.insert({ id: newId(), payrollId: id, employeeId: e.id, wallet: e.wallet as string, amountUsdc: amounts[i], displayAmount: e.salaryAmount, displayCurrency: e.currency }),
  )
  return payroll
}

export default function Schedules() {
  const { user, company, role } = useAuth()
  const d = useCompanyData()
  const { demoMode } = useSettings()
  const { data: rates } = useRates()
  const oc = useOnchainCompany(company?.onchainId)
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('Monthly salaries')
  const [freq, setFreq] = useState<Frequency>('monthly')
  const [anchor, setAnchor] = useState(1)
  const [removing, setRemoving] = useState<PayrollSchedule>()
  const [queueFor, setQueueFor] = useState<PayrollSchedule>()
  const [busy, setBusy] = useState(false)

  if (!company || !user) return null
  const keeperSet = oc.data && oc.data.executor !== '0x0000000000000000000000000000000000000000'

  const create = () => {
    if (!name.trim()) return toast.error('Enter a name')
    db.schedules.insert({ id: newId(), companyId: company.id, name: name.trim(), frequency: freq, anchor: freq === 'daily' ? 0 : anchor, active: true, employeeIds: [], createdAt: nowMs() })
    logAudit(user, 'schedule.created', 'schedule', `${name} (${freq})`, company.id)
    toast.success('Schedule created')
    setOpen(false)
  }

  const draftNext = (s: PayrollSchedule, runMs: number) => {
    if (!rates) return
    const p = prepare(s, runMs, company, user, rates, false)
    if (!p) return toast.error('No payable employees for that date (approved wallets needed, once per month).')
    logAudit(user, 'schedule.draft', 'payroll', p.title, company.id)
    toast.success('Draft created. Review and approve it on the Payroll page.')
  }

  const queueThree = async () => {
    if (!queueFor || !rates) return
    setBusy(true)
    let done = 0
    try {
      for (const runMs of nextRuns(queueFor, 3)) {
        const p = prepare(queueFor, runMs, company, user, rates, true)
        if (!p) continue
        const r = await queuePayroll(user, company, p)
        if (!r.ok) {
          db.payrolls.update(p.id, { status: 'draft' })
          if (!r.cancelled) toast.error(r.error ?? 'Could not queue')
          break
        }
        done++
      }
      if (done) toast.success(`${done} month${done > 1 ? 's' : ''} queued. The keeper pays them on their dates.`)
      setQueueFor(undefined)
    } catch (e) { toast.error(describeError(e)) } finally { setBusy(false) }
  }

  const monthlyTotal = rates ? sumUsdc(d.activeEmployees.filter((e) => !payBlocker(e)).map((e) => toUsdcString(e.salaryAmount, e.currency, rates))) : '0'

  return (
    <div className="space-y-6">
      <PageHeader title="Scheduled payroll" subtitle="Recurring pay dates, reminders, and automatic release by your keeper" action={<Button variant="electric" icon={Plus} onClick={() => setOpen(true)}>New schedule</Button>} />
      {demoMode && <DemoBanner />}

      <Card className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="font-display font-semibold">How automatic payment works</h3>
            <p className="mt-1 max-w-2xl text-sm text-navy-500">You queue each month's payroll once and sign it. The contract reserves the money from your prepaid budget. Your keeper wallet then releases it on the pay date. It cannot change recipients or amounts.</p>
          </div>
          <Badge tone={keeperSet ? 'success' : 'warning'}>{keeperSet ? 'Keeper configured' : 'No keeper set'}</Badge>
        </div>
        {!keeperSet && !demoMode && <div className="mt-4"><Notice tone="warning" title="Set a keeper wallet">Without a keeper, due batches wait until a manager pays them on the Budget page. Set one under Budget & payments, then run the keeper script (see the README).</Notice></div>}
      </Card>

      <Notice tone="info" title="One salary per wallet each month">The payroll contract allows one payment per wallet per calendar month. Daily and weekly schedules therefore create reminders and drafts, and only monthly schedules can be queued onchain automatically.</Notice>

      {d.schedules.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No schedules" text="Create a monthly schedule to queue payrolls ahead of time." action={<Button variant="electric" icon={Plus} onClick={() => setOpen(true)}>New schedule</Button>} /></Card>
      ) : (
        d.schedules.map((s) => {
          const runs = nextRuns(s, 3)
          const soon = runs[0] && daysUntil(runs[0]) <= 3
          return (
            <Card key={s.id}>
              <CardHeader
                title={s.name}
                subtitle={`${s.frequency === 'daily' ? 'Every day' : s.frequency === 'weekly' ? `Every ${WEEKDAYS[s.anchor]}` : `Day ${s.anchor} of every month`} at 09:00 UTC`}
                action={
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" icon={Power} onClick={() => db.schedules.update(s.id, { active: !s.active })}>{s.active ? 'Pause' : 'Resume'}</Button>
                    <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setRemoving(s)} aria-label="Delete schedule" />
                  </div>
                }
              />
              <div className="space-y-4 p-5">
                {soon && s.active && <Notice tone="warning" title="Payroll is due soon">The next run is in {Math.max(daysUntil(runs[0]), 0)} day(s). Prepare and queue it so it can be paid on time.</Notice>}
                <ul className="divide-y divide-navy-100 rounded-xl border border-navy-100">
                  {runs.map((r) => {
                    const made = d.payrolls.find((p) => p.scheduleId === s.id && p.executeAfter === r && p.status !== 'cancelled')
                    return (
                      <li key={r} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="font-medium">{fmtDateTime(r)}</span>
                        <span className="text-navy-400">in {daysUntil(r)} days</span>
                        {made ? <Badge tone={made.status === 'queued' ? 'warning' : 'info'}>{made.status}</Badge> : <Button size="sm" variant="secondary" disabled={!s.active} onClick={() => draftNext(s, r)}>Prepare draft</Button>}
                      </li>
                    )
                  })}
                </ul>
                {s.frequency === 'monthly' && (
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-sm text-navy-500">Estimated monthly total: <UsdcAmount value={monthlyTotal} className="font-medium text-navy-900" /></p>
                    <Button variant="electric" icon={Zap} disabled={!s.active || role === undefined} onClick={() => setQueueFor(s)}>Queue next 3 months</Button>
                  </div>
                )}
              </div>
            </Card>
          )
        })
      )}

      <Dialog open={open} onClose={() => setOpen(false)} title="New schedule">
        <div className="space-y-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Frequency"><Select value={freq} onChange={(e) => setFreq(e.target.value as Frequency)}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option></Select></Field>
          {freq === 'monthly' && <Field label="Day of month" hint="1 to 28, so every month has the date"><Input type="number" min={1} max={28} value={anchor} onChange={(e) => setAnchor(Math.min(28, Math.max(1, Number(e.target.value) || 1)))} /></Field>}
          {freq === 'weekly' && <Field label="Weekday"><Select value={anchor} onChange={(e) => setAnchor(Number(e.target.value))}>{WEEKDAYS.map((w, i) => <option key={w} value={i}>{w}</option>)}</Select></Field>}
          <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button><Button variant="electric" onClick={create}>Create schedule</Button></div>
        </div>
      </Dialog>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(undefined)} danger title="Delete schedule" confirmLabel="Delete" onConfirm={() => { if (removing) db.schedules.remove(removing.id); setRemoving(undefined) }}>
        <p>Delete <b>{removing?.name}</b>? Payrolls already queued onchain are not affected.</p>
      </ConfirmDialog>

      <ConfirmDialog open={!!queueFor} onClose={() => setQueueFor(undefined)} loading={busy} onConfirm={() => void queueThree()} title="Queue the next 3 months" confirmLabel={demoMode ? 'Queue (DEMO)' : 'Sign and queue'}>
        <p>This approves and queues up to 3 payrolls of about <b>{monthlyTotal} USDC</b> each, one transaction (one signature) per month. Each month needs its own unreserved budget and allowance.</p>
        <p className="text-navy-400">Employees without an approved wallet are skipped. You can cancel any queued month before it is paid.</p>
        {demoMode && <Notice tone="demo">Demo mode: nothing is sent onchain.</Notice>}
      </ConfirmDialog>
    </div>
  )
}
