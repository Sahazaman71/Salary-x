import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { BadgeCheck, FileText, ShieldCheck, Wallet } from 'lucide-react'
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Notice, PageHeader, StatCard, Td, Th } from '@/components/ui'
import { EstimateNotice, TxLink, TxStatusBadge, UsdcAmount } from '@/components/shared'
import { useUsdcBalance } from '@/hooks/useChain'
import { useAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { STATUS, addressUrl, readBatch } from '@/lib/chain'
import { periodLabel } from '@/lib/payroll'
import { convert, toUsdcString, useRates } from '@/lib/rates'
import { db, useTable } from '@/lib/store'
import { submitWalletRemote } from '@/lib/remote'
import { backendMode } from '@/lib/supabase'
import { fmtDate, fmtMoney, isValidWallet, shortAddress } from '@/lib/utils'

export function useEmployeeData() {
  const { user } = useAuth()
  const employees = useTable('employees')
  const items = useTable('payrollItems')
  const payrolls = useTable('payrolls')
  const txs = useTable('transactions')
  const companies = useTable('companies')
  return useMemo(() => {
    const employee = employees.find((e) => e.profileId === user?.id)
    const company = companies.find((c) => c.id === employee?.companyId)
    const paid = items
      .filter((i) => i.employeeId === employee?.id)
      .map((i) => ({ item: i, payroll: payrolls.find((p) => p.id === i.payrollId) }))
      .filter((x): x is { item: typeof x.item; payroll: NonNullable<typeof x.payroll> } => !!x.payroll && x.payroll.status === 'executed')
      .map((x) => ({ ...x, tx: txs.find((t) => t.payrollId === x.payroll.id && t.kind === 'batch_execute' && t.status !== 'failed') }))
      .sort((a, b) => b.payroll.executeAfter - a.payroll.executeAfter)
    return { employee, company, paid }
  }, [employees, items, payrolls, txs, companies, user])
}

export default function EmployeePortal() {
  const { user } = useAuth()
  const { employee, company, paid } = useEmployeeData()
  const { data: rates } = useRates()
  const { data: balance } = useUsdcBalance(employee?.wallet && isValidWallet(employee.wallet) ? employee.wallet : undefined)
  const [wallet, setWallet] = useState('')
  const [verifying, setVerifying] = useState<string>()
  const [verified, setVerified] = useState<Record<string, boolean>>({})

  if (!employee || !company) return <Notice tone="danger" title="Employee record not found">Your account is not linked to an employee record. Ask your company admin.</Notice>

  const walletErr = wallet && !isValidWallet(wallet) ? 'Not a valid wallet address' : undefined
  const submitWallet = async () => {
    if (!isValidWallet(wallet)) return
    if (backendMode === 'supabase') {
      const err = await submitWalletRemote(wallet)
      if (err) {
        toast.error(err)
        return
      }
    }
    db.employees.update(employee.id, { wallet, walletStatus: 'pending' }, { skipRemote: backendMode === 'supabase' })
    logAudit(user, 'employee.wallet_submitted', 'employee', wallet, company.id)
    toast.success('Wallet submitted. Your employer must approve it before you are paid.')
    setWallet('')
  }

  const verify = async (id: string, batchId?: string, demo?: boolean) => {
    if (demo || !batchId) return toast('This was a DEMO payment. There is nothing to verify onchain.')
    setVerifying(id)
    try {
      const b = await readBatch(BigInt(batchId))
      setVerified({ ...verified, [id]: b.status === STATUS.Executed })
      toast[b.status === STATUS.Executed ? 'success' : 'error'](b.status === STATUS.Executed ? 'The contract confirms this payroll was paid.' : 'The contract does not show this payroll as paid.')
    } catch { toast.error('Could not reach the network. Try again.') } finally { setVerifying(undefined) }
  }

  const salaryEst = rates ? toUsdcString(employee.salaryAmount, employee.currency, rates) : undefined
  const latest = paid[0]

  return (
    <div className="space-y-6">
      <PageHeader title={`Hello, ${employee.name.split(' ')[0]}`} subtitle={`${company.name} · ${employee.country}`} />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Wallet} label="Monthly salary" value={fmtMoney(employee.salaryAmount, employee.currency)} sub={salaryEst ? `About ${salaryEst} USDC (estimate)` : undefined} />
        <StatCard icon={BadgeCheck} label="Last payment" value={latest ? <UsdcAmount value={latest.item.amountUsdc} /> : '-'} sub={latest ? fmtDate(latest.payroll.executeAfter) : 'No payments yet'} />
        <StatCard icon={ShieldCheck} label="Your wallet balance" value={employee.walletStatus === 'approved' && balance !== undefined ? <UsdcAmount value={balance} /> : '-'} sub="USDC on Arc Testnet" />
      </div>

      <Card>
        <CardHeader title="Payout wallet" subtitle="Salaries are sent to this Arc wallet in USDC." action={<Badge tone={employee.walletStatus === 'approved' ? 'success' : employee.walletStatus === 'pending' ? 'warning' : 'neutral'}>{employee.walletStatus === 'approved' ? 'Approved' : employee.walletStatus === 'pending' ? 'Awaiting approval' : 'Not set'}</Badge>} />
        <div className="space-y-4 p-5">
          {employee.wallet && <p className="text-sm">Current: <a className="break-all font-mono text-electric-600 hover:underline" href={addressUrl(employee.wallet)} target="_blank" rel="noopener noreferrer">{employee.wallet}</a></p>}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1"><Field label={employee.wallet ? 'Submit a new wallet' : 'Your wallet address'} error={walletErr} hint="Only use a wallet you control. Changing it needs your employer's approval again."><Input className="font-mono" placeholder="0x..." value={wallet} onChange={(e) => setWallet(e.target.value.trim())} /></Field></div>
            <Button variant="electric" disabled={!isValidWallet(wallet)} onClick={() => void submitWallet()}>Submit wallet</Button>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title="Payment history" subtitle="Payslips are available for confirmed payments" />
        {paid.length === 0 ? (
          <EmptyState icon={FileText} title="No payments yet" text="Your paid salaries and payslips will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Period</Th><Th>Amount</Th><Th>Status</Th><Th>Transaction</Th><Th /></tr></thead>
              <tbody className="divide-y divide-navy-100">
                {paid.map(({ item, payroll, tx }) => (
                  <tr key={item.id}>
                    <Td className="font-medium text-navy-900">{periodLabel(payroll.period)}</Td>
                    <Td><UsdcAmount value={item.amountUsdc} />{rates && <p className="text-xs text-navy-400">≈ {fmtMoney(convert(Number(item.amountUsdc), 'USD', employee.currency, rates), employee.currency)}</p>}</Td>
                    <Td>{payroll.demo ? <TxStatusBadge status="demo" /> : <TxStatusBadge status="success" verified={tx?.verified || verified[item.id]} />}</Td>
                    <Td>{payroll.demo ? <span className="text-xs text-fuchsia-700">DEMO</span> : <TxLink hash={tx?.hash} />}</Td>
                    <Td>
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="ghost" loading={verifying === item.id} onClick={() => void verify(item.id, payroll.onchainBatchId, payroll.demo)}>Verify</Button>
                        <Link to={`/app/me/payslip/${item.id}`}><Button size="sm" variant="secondary" icon={FileText}>Payslip</Button></Link>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <EstimateNotice />
      <p className="text-xs text-navy-300">Wallet shown: {shortAddress(employee.wallet) || 'none'}</p>
    </div>
  )
}
