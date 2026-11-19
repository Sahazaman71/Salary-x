import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { BarChart3, Download, FileText } from 'lucide-react'
import { Button, Card, CardHeader, EmptyState, PageHeader, StatCard, Td, Th } from '@/components/ui'
import { EstimateNotice } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { toCsv } from '@/lib/csv'
import { buildTablePdf } from '@/lib/pdf'
import { periodLabel } from '@/lib/payroll'
import { toUsdcString, useRates } from '@/lib/rates'
import { downloadFile, fmtUsdc } from '@/lib/utils'

const COLORS = ['#2f62ff', '#0b1a3d', '#5a86ff', '#455b87', '#8cb0ff', '#1a47f0', '#9aabcb']

export default function Reports() {
  const d = useCompanyData()
  const { data: rates } = useRates()

  const monthly = new Map<number, { total: number; count: number }>()
  d.payrolls.filter((p) => p.status === 'executed' && !p.demo).forEach((p) => {
    const m = monthly.get(p.period) ?? { total: 0, count: 0 }
    m.total += Number(p.totalUsdc)
    m.count += d.items.filter((i) => i.payrollId === p.id).length
    monthly.set(p.period, m)
  })
  const monthRows = [...monthly.entries()].sort((a, b) => b[0] - a[0]).map(([p, m]) => ({ period: periodLabel(p), total: m.total, count: m.count }))

  const usdc = (e: (typeof d.employees)[number]) => (rates ? Number(toUsdcString(e.salaryAmount, e.currency, rates)) : 0)
  const active = d.activeEmployees
  const byCountry = new Map<string, { total: number; count: number }>()
  active.forEach((e) => {
    const c = byCountry.get(e.country) ?? { total: 0, count: 0 }
    c.total += usdc(e); c.count += 1
    byCountry.set(e.country, c)
  })
  const countryRows = [...byCountry.entries()].map(([country, v]) => ({ country, ...v })).sort((a, b) => b.total - a.total)
  const salaries = active.map(usdc).sort((a, b) => a - b)
  const sum = salaries.reduce((a, b) => a + b, 0)
  const median = salaries.length ? (salaries[Math.floor((salaries.length - 1) / 2)] + salaries[Math.ceil((salaries.length - 1) / 2)]) / 2 : 0

  const exportCsv = () => downloadFile('salaryx-report.csv', toCsv([
    ...monthRows.map((r) => ({ section: 'monthly_paid', label: r.period, usdc: r.total.toFixed(2), employees: r.count })),
    ...countryRows.map((r) => ({ section: 'country_monthly_payroll_estimate', label: r.country, usdc: r.total.toFixed(2), employees: r.count })),
  ]))
  const exportPdf = () => {
    const body = [
      ...monthRows.map((r) => ['Paid', r.period, r.total.toFixed(2), r.count]),
      ...countryRows.map((r) => ['Payroll estimate', r.country, r.total.toFixed(2), r.count]),
    ]
    buildTablePdf('Payroll report', `${d.company?.name ?? ''} - generated ${new Date().toLocaleDateString()}. Amounts in USDC. Country figures are estimates.`, ['Section', 'Label', 'USDC', 'Employees'], body).save('salaryx-report.pdf')
  }

  const empty = d.employees.length === 0 && monthRows.length === 0
  return (
    <div className="space-y-6">
      <PageHeader title="Reports & analytics" subtitle="Payroll by month and country" action={<div className="flex gap-2"><Button variant="secondary" icon={Download} onClick={exportCsv} disabled={empty}>CSV</Button><Button variant="secondary" icon={FileText} onClick={exportPdf} disabled={empty}>PDF</Button></div>} />
      {empty ? (
        <Card><EmptyState icon={BarChart3} title="Nothing to report yet" text="Add employees and run a payroll to see analytics." /></Card>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-4">
            <StatCard icon={BarChart3} label="Average salary" value={fmtUsdc(salaries.length ? sum / salaries.length : 0)} sub="Estimate, per month" />
            <StatCard icon={BarChart3} label="Median salary" value={fmtUsdc(median)} sub="Estimate" />
            <StatCard icon={BarChart3} label="Highest" value={fmtUsdc(salaries[salaries.length - 1] ?? 0)} />
            <StatCard icon={BarChart3} label="Lowest" value={fmtUsdc(salaries[0] ?? 0)} />
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader title="Payroll by country" subtitle="Monthly payroll estimate in USDC" />
              <div className="h-72 p-4">
                {countryRows.length === 0 ? <EmptyState icon={BarChart3} title="No active employees" text="Activate employees to see this." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart><Pie data={countryRows} dataKey="total" nameKey="country" innerRadius={55} outerRadius={95} paddingAngle={2}>{countryRows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => fmtUsdc(Number(v))} /></PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
            <Card>
              <CardHeader title="Paid by month" subtitle="Confirmed onchain payrolls" />
              <div className="h-72 p-4">
                {monthRows.length === 0 ? <EmptyState icon={BarChart3} title="No confirmed payrolls" text="Paid months appear here." /> : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={[...monthRows].reverse()}><CartesianGrid vertical={false} stroke="#e4eaf4" /><XAxis dataKey="period" tickLine={false} axisLine={false} fontSize={11} /><YAxis tickLine={false} axisLine={false} fontSize={12} width={48} /><Tooltip formatter={(v) => fmtUsdc(Number(v))} /><Bar dataKey="total" fill="#2f62ff" radius={[8, 8, 0, 0]} /></BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </Card>
          </div>
          <Card>
            <CardHeader title="Country overview" />
            <div className="overflow-x-auto"><table className="w-full"><thead><tr><Th>Country</Th><Th>Employees</Th><Th>Monthly payroll (est.)</Th></tr></thead>
              <tbody className="divide-y divide-navy-100">{countryRows.map((r) => <tr key={r.country}><Td className="font-medium text-navy-900">{r.country}</Td><Td>{r.count}</Td><Td className="num">{fmtUsdc(r.total)}</Td></tr>)}</tbody></table></div>
          </Card>
          <EstimateNotice />
        </>
      )}
    </div>
  )
}
