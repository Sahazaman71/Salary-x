import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button, Card, CardHeader, Notice, PageHeader, Td } from '@/components/ui'
import { TxStatusBadge, UsdcAmount } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { txUrl } from '@/lib/chain'
import { recheckTx } from '@/lib/tx'
import { fmtDateTime, shortAddress } from '@/lib/utils'
import { kindLabel } from './History'

export default function TransactionDetail() {
  const { id } = useParams()
  const { transactions, payrolls, items, employees } = useCompanyData()
  const [busy, setBusy] = useState(false)
  const tx = transactions.find((t) => t.id === id)
  if (!tx) return <Notice tone="danger" title="Transaction not found">It may belong to another company. <Link className="underline" to="/app/history">Back to history</Link></Notice>
  const payroll = payrolls.find((p) => p.id === tx.payrollId)
  const lines = items.filter((i) => i.payrollId === tx.payrollId)

  const recheck = async () => {
    setBusy(true)
    const r = await recheckTx(tx)
    setBusy(false)
    toast(r === 'pending' ? 'Still pending' : r === 'success' ? 'Confirmed onchain' : 'Transaction failed onchain')
  }

  const rows: [string, React.ReactNode][] = [
    ['Type', <span className="capitalize">{kindLabel(tx.kind)}</span>],
    ['Status', <TxStatusBadge status={tx.status} verified={tx.verified} />],
    ['Amount', <UsdcAmount value={tx.amountUsdc} />],
    ['Created', fmtDateTime(tx.createdAt)],
    ['Payroll', payroll?.title ?? '-'],
    ['Block', tx.blockNumber ?? '-'],
    ['Verification', tx.status === 'demo' ? 'Not verified. Simulated in demo mode.' : tx.verified ? 'Receipt succeeded and emitted events match what was requested.' : 'Not yet verified onchain.'],
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link to="/app/history" className="inline-flex items-center gap-1 text-sm text-navy-400 hover:text-navy-700"><ArrowLeft className="h-4 w-4" />Payment history</Link>
      <PageHeader title="Transaction details" />
      {tx.status === 'demo' && <Notice tone="demo" title="DEMO transaction">This was simulated. No transaction was sent and there is no hash.</Notice>}
      {tx.error && <Notice tone={tx.status === 'failed' ? 'danger' : 'warning'} title={tx.status === 'failed' ? 'Failed' : 'Needs attention'}>{tx.error}</Notice>}
      <Card>
        <CardHeader title="Overview" />
        <table className="w-full"><tbody className="divide-y divide-navy-100">
          {rows.map(([k, v]) => <tr key={k}><Td className="w-40 text-navy-400">{k}</Td><Td>{v}</Td></tr>)}
          <tr><Td className="w-40 text-navy-400">Hash</Td><Td className="break-all font-mono text-xs">{tx.hash ?? '-'}</Td></tr>
        </tbody></table>
        <div className="flex flex-wrap gap-2 border-t border-navy-100 p-4">
          {tx.hash && <a href={txUrl(tx.hash)} target="_blank" rel="noopener noreferrer"><Button variant="secondary" icon={ExternalLink}>View on explorer</Button></a>}
          {tx.status === 'pending' && tx.hash && <Button variant="electric" icon={RefreshCw} loading={busy} onClick={() => void recheck()}>Check confirmation</Button>}
        </div>
      </Card>
      {lines.length > 0 && (
        <Card>
          <CardHeader title="Recipients" subtitle={`${lines.length} payments in this payroll`} />
          <table className="w-full"><tbody className="divide-y divide-navy-100">
            {lines.map((i) => (
              <tr key={i.id}><Td>{employees.find((e) => e.id === i.employeeId)?.name ?? 'Removed employee'}</Td><Td className="font-mono text-xs">{shortAddress(i.wallet)}</Td><Td className="text-right"><UsdcAmount value={i.amountUsdc} /></Td></tr>
            ))}
          </tbody></table>
        </Card>
      )}
    </div>
  )
}
