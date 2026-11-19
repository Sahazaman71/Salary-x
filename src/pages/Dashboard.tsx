import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useAccount } from 'wagmi'
import { CalendarClock, Check, Circle, Landmark, ReceiptText, Users, Wallet } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, PageHeader, Skeleton, StatCard, Td, Th } from '@/components/ui'
import { DemoBanner, PayrollStatusBadge, TxStatusBadge, UsdcAmount } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { useOnchainCompany } from '@/hooks/useChain'
import { PAYROLL_ADDRESS } from '@/lib/chain'
import { periodLabel, sumUsdc } from '@/lib/payroll'
import { toUsdcString, useRates } from '@/lib/rates'
import { useSettings } from '@/lib/settings'
import { fmtDate, fmtUsdc } from '@/lib/utils'

export default function Dashboard() {
  const d = useCompanyData()
  const { isConnected } = useAccount()
  const { demoMode } = useSettings()
  const oc = useOnchainCompany(d.company?.onchainId)
  const { data: rates } = useRates()
  const cur = d.company?.defaultCurrency ?? 'USD'

  const monthly = sumUsdc(d.activeEmployees.map((e) => (rates ? toUsdcString(e.salaryAmount, e.currency, rates) : '0')))

  const byMonth = new Map<number, number>()
  d.payrolls.filter((p) => p.status === 'executed' && !p.demo).forEach((p) => byMonth.set(p.period, (byMonth.get(p.period) ?? 0) + Number(p.totalUsdc)))
  const chart = [...byMonth.entries()].sort((a, b) => a[0] - b[0]).slice(-6).map(([p, v]) => ({ month: periodLabel(p).slice(0, 3) + ' ' + String(p).slice(2, 4), total: Number(v.toFixed(2)) }))

  const upcoming = d.payrolls.filter((p) => p.status === 'queued' || p.status === 'approved').sort((a, b) => a.executeAfter - b.executeAfter).slice(0, 4)
  const recent = d.transactions.slice(0, 5)
  const registered = oc.data?.registered
  const steps = [
    { done: !!registered || demoMode, label: 'Register your company onchain', to: '/app/budget' },
    { done: d.employees.length > 0, label: 'Add your employees', to: '/app/employees/new' },
    { done: Number(oc.data?.budgetUsdc ?? 0) > 0, label: 'Fund your payroll budget', to: '/app/budget' },
    { done: Number(oc.data?.allowanceUsdc ?? 0) > 0, label: 'Set a monthly allowance', to: '/app/budget' },
    { done: d.payrolls.length > 0, label: 'Create your first payroll', to: '/app/payroll' },
  ]
  const incomplete = steps.some((s) => !s.done)

  return (
    <div className="space-y-6">
      <PageHeader title={`Welcome, ${d.company?.name ?? ''}`} subtitle="Your payroll at a glance" action={<Link to="/app/payroll"><Button variant="electric" icon={ReceiptText}>New payroll</Button></Link>} />
      {demoMode && <DemoBanner />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active employees" icon={Users} value={d.activeEmployees.length} sub={`${d.employees.length} total`} />
        <StatCard label={`Monthly payroll (est.)`} icon={ReceiptText} value={<UsdcAmount value={monthly} />} sub={`Estimated from salaries in ${cur} and others`} />
        <StatCard
          label="Prepaid budget"
          icon={Landmark}
          value={oc.isLoading ? <Skeleton className="h-8 w-28" /> : PAYROLL_ADDRESS && registered ? <UsdcAmount value={oc.data?.budgetUsdc ?? 0} /> : '-'}
          sub={registered ? `${fmtUsdc(oc.data?.availableUsdc ?? 0)} unreserved` : 'Register onchain to start'}
        />
        <StatCard label="Paid to date" icon={Wallet} value={<UsdcAmount value={d.paidTotal} />} sub="Confirmed onchain payrolls" />
      </div>

      {incomplete && (
        <Card>
          <CardHeader title="Get set up" subtitle={isConnected ? 'Finish these steps to run payroll automatically' : 'Connect your wallet to continue'} />
          <ul className="grid gap-px bg-navy-100 sm:grid-cols-2 lg:grid-cols-5">
            {steps.map((s) => (
              <li key={s.label} className="bg-white">
                <Link to={s.to} className="flex h-full items-start gap-3 p-4 text-sm hover:bg-navy-50">
                  {s.done ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-navy-300" />}
                  <span className={s.done ? 'text-navy-400 line-through' : 'font-medium text-navy-800'}>{s.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Monthly salary paid" subtitle="Confirmed onchain payrolls, in USDC" />
          <div className="h-72 p-4">
            {chart.length === 0 ? (
              <EmptyState icon={ReceiptText} title="No payments yet" text="Paid payrolls appear here once a batch is confirmed onchain." />
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart}>
                  <CartesianGrid vertical={false} stroke="#e4eaf4" />
                  <XAxis dataKey="month" tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={48} />
                  <Tooltip formatter={(v) => fmtUsdc(Number(v))} cursor={{ fill: '#eef4ff' }} />
                  <Bar dataKey="total" fill="#2f62ff" radius={[8, 8, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </Card>
        <Card>
          <CardHeader title="Upcoming payroll" />
          {upcoming.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Nothing scheduled" text="Queue a payroll to see it here." action={<Link to="/app/payroll"><Button size="sm">Create payroll</Button></Link>} />
          ) : (
            <ul className="divide-y divide-navy-100">
              {upcoming.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-4">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{p.title}</p>
                    <p className="text-xs text-navy-400">{fmtDate(p.executeAfter)}</p>
                  </div>
                  <div className="text-right">
                    <UsdcAmount value={p.totalUsdc} className="text-sm font-medium" />
                    <div className="mt-1"><PayrollStatusBadge status={p.status} demo={p.demo} /></div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent transactions" action={<Link to="/app/history" className="text-sm font-medium text-electric-600 hover:underline">View all</Link>} />
        {recent.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No transactions yet" text="Deposits, payroll batches and payments are recorded here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Type</Th><Th>Amount</Th><Th>Status</Th><Th>Date</Th></tr></thead>
              <tbody className="divide-y divide-navy-100">
                {recent.map((t) => (
                  <tr key={t.id} className="hover:bg-navy-50/60">
                    <Td><Link to={`/app/history/${t.id}`} className="font-medium capitalize hover:text-electric-600">{t.kind.replace('_', ' ')}</Link></Td>
                    <Td><UsdcAmount value={t.amountUsdc} /></Td>
                    <Td><TxStatusBadge status={t.status} verified={t.verified} /></Td>
                    <Td>{fmtDate(t.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <p className="text-xs text-navy-300"><Badge>Arc Testnet</Badge> Amounts are USDC settlement values. Local currency conversions are estimates.</p>
    </div>
  )
}
