import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Download } from 'lucide-react'
import { Badge, Button, Card, Notice, PageHeader, Td } from '@/components/ui'
import { TxLink, UsdcAmount } from '@/components/shared'
import { buildPayslipPdf } from '@/lib/pdf'
import { periodLabel } from '@/lib/payroll'
import { convert, useRates } from '@/lib/rates'
import { fmtDateTime, fmtMoney } from '@/lib/utils'
import { useEmployeeData } from './EmployeePortal'

export default function Payslip() {
  const { itemId } = useParams()
  const { employee, company, paid } = useEmployeeData()
  const { data: rates } = useRates()
  const row = paid.find((p) => p.item.id === itemId)
  if (!employee || !company || !row) return <Notice tone="danger" title="Payslip not found">Payslips are only available for confirmed payments. <Link className="underline" to="/app/me">Back</Link></Notice>
  const { item, payroll, tx } = row
  const est = rates ? fmtMoney(convert(Number(item.amountUsdc), 'USD', employee.currency, rates), employee.currency) : '-'
  const verified = !payroll.demo && !!tx?.verified

  const download = () =>
    buildPayslipPdf({
      company: company.name, employee: employee.name, email: employee.email, country: employee.country,
      period: periodLabel(payroll.period), paidAt: payroll.executeAfter, amountUsdc: item.amountUsdc, displayAmount: est,
      displayCurrency: employee.currency, wallet: item.wallet, txHash: tx?.hash, verified, demo: payroll.demo,
    }).save(`payslip-${payroll.period}-${employee.name.replace(/\s+/g, '-').toLowerCase()}.pdf`)

  const rows: [string, React.ReactNode][] = [
    ['Employee', employee.name], ['Company', company.name], ['Pay period', periodLabel(payroll.period)], ['Pay date', fmtDateTime(payroll.executeAfter)],
    ['Wallet', <span className="break-all font-mono text-xs">{item.wallet}</span>],
    ['Transaction', payroll.demo ? <Badge tone="demo">DEMO, no transaction</Badge> : <TxLink hash={tx?.hash} />],
    ['Verification', verified ? 'Confirmed onchain on Arc Testnet' : payroll.demo ? 'Not verified (DEMO)' : 'Confirmed from contract state'],
  ]
  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link to="/app/me" className="inline-flex items-center gap-1 text-sm text-navy-400 hover:text-navy-700"><ArrowLeft className="h-4 w-4" />My salary</Link>
      <PageHeader title="Digital payslip" action={<Button variant="electric" icon={Download} onClick={download}>Download PDF</Button>} />
      {payroll.demo && <Notice tone="demo" title="DEMO payslip">This payment was simulated. No onchain transaction exists.</Notice>}
      <Card>
        <div className="rounded-t-2xl bg-navy-900 p-6 text-white">
          <p className="text-xs text-navy-300">Net salary settled</p>
          <UsdcAmount value={item.amountUsdc} className="font-display text-3xl font-semibold" />
          <p className="mt-1 text-xs text-navy-300">≈ {est} in {employee.currency} (estimate, not the settled amount)</p>
        </div>
        <table className="w-full"><tbody className="divide-y divide-navy-100">{rows.map(([k, v]) => <tr key={k}><Td className="w-36 text-navy-400">{k}</Td><Td>{v}</Td></tr>)}</tbody></table>
      </Card>
      <p className="text-xs text-navy-300">Settlement is in USDC on Arc. SalaryX does not provide local bank payouts.</p>
    </div>
  )
}
