import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Download, ReceiptText, RefreshCw } from 'lucide-react'
import { Button, Card, EmptyState, Input, PageHeader, Select, Td, Th } from '@/components/ui'
import { TxLink, TxStatusBadge, UsdcAmount } from '@/components/shared'
import { useCompanyData } from '@/hooks/useCompanyData'
import { recheckTx } from '@/lib/tx'
import { toCsv } from '@/lib/csv'
import { downloadFile, fmtDateTime } from '@/lib/utils'

export const kindLabel = (k: string) => k.replace(/_/g, ' ')

export default function History() {
  const { transactions, payrolls } = useCompanyData()
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [checking, setChecking] = useState(false)

  const shown = transactions.filter((t) => (status === 'all' || t.status === status) && `${t.kind} ${t.hash ?? ''} ${payrolls.find((p) => p.id === t.payrollId)?.title ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  const pending = transactions.filter((t) => t.status === 'pending' && t.hash)

  const recheck = async () => {
    setChecking(true)
    const results = await Promise.all(pending.map(recheckTx))
    setChecking(false)
    toast(`${results.filter((r) => r === 'success').length} confirmed, ${results.filter((r) => r === 'pending').length} still pending`)
  }

  const exportCsv = () =>
    downloadFile('salaryx-payments.csv', toCsv(shown.map((t) => ({ date: new Date(t.createdAt).toISOString(), type: t.kind, usdc: t.amountUsdc, status: t.status, verified: t.verified ? 'yes' : 'no', hash: t.hash ?? '' }))))

  return (
    <div>
      <PageHeader title="Payment history" subtitle="Every onchain action, with its verification status" action={<div className="flex gap-2">{pending.length > 0 && <Button variant="secondary" icon={RefreshCw} loading={checking} onClick={() => void recheck()}>Re-check {pending.length} pending</Button>}<Button variant="secondary" icon={Download} onClick={exportCsv} disabled={!shown.length}>Export CSV</Button></div>} />
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-navy-100 p-4">
          <Input className="min-w-52 flex-1" placeholder="Search by type, payroll or hash" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">All statuses</option><option value="success">Confirmed</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="demo">Demo</option>
          </Select>
        </div>
        {transactions.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No transactions yet" text="Deposits, queued payrolls and payments will appear here." />
        ) : shown.length === 0 ? (
          <EmptyState icon={ReceiptText} title="No matches" text="Try a different search or filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Type</Th><Th>Payroll</Th><Th>Amount</Th><Th>Status</Th><Th>Hash</Th><Th>Date</Th></tr></thead>
              <tbody className="divide-y divide-navy-100">
                {shown.map((t) => (
                  <tr key={t.id} className="hover:bg-navy-50/60">
                    <Td><Link to={`/app/history/${t.id}`} className="font-medium capitalize text-navy-900 hover:text-electric-600">{kindLabel(t.kind)}</Link></Td>
                    <Td>{payrolls.find((p) => p.id === t.payrollId)?.title ?? '-'}</Td>
                    <Td><UsdcAmount value={t.amountUsdc} /></Td>
                    <Td><TxStatusBadge status={t.status} verified={t.verified} /></Td>
                    <Td>{t.status === 'demo' ? <span className="text-xs text-fuchsia-700">No transaction</span> : <TxLink hash={t.hash} />}</Td>
                    <Td>{fmtDateTime(t.createdAt)}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
