import { useQuery } from '@tanstack/react-query'
import { Building2, ShieldCheck, Users } from 'lucide-react'
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Td, Th } from '@/components/ui'
import { UsdcAmount } from '@/components/shared'
import { PAYROLL_ADDRESS, addressUrl } from '@/lib/chain'
import { sumUsdc } from '@/lib/payroll'
import { useTable } from '@/lib/store'
import { fmtDate, fmtDateTime } from '@/lib/utils'
import { config } from '@/config'
import { readContract } from 'wagmi/actions'
import { salaryxAbi } from '@/contracts/salaryx'

export default function PlatformAdmin() {
  const companies = useTable('companies')
  const employees = useTable('employees')
  const payrolls = useTable('payrolls')
  const logs = [...useTable('auditLogs')].sort((a, b) => b.createdAt - a.createdAt).slice(0, 25)
  const contract = useQuery({
    queryKey: ['contract-state'],
    enabled: !!PAYROLL_ADDRESS,
    queryFn: async () => {
      const address = PAYROLL_ADDRESS as `0x${string}`
      const [owner, paused, open] = await Promise.all([
        readContract(config, { address, abi: salaryxAbi, functionName: 'owner' }),
        readContract(config, { address, abi: salaryxAbi, functionName: 'paused' }),
        readContract(config, { address, abi: salaryxAbi, functionName: 'registrationOpen' }),
      ])
      return { owner, paused, open }
    },
  })

  return (
    <div className="space-y-6">
      <PageHeader title="Platform admin" subtitle="Companies and activity in this workspace" />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard icon={Building2} label="Companies" value={companies.length} />
        <StatCard icon={Users} label="Employees" value={employees.length} />
        <StatCard icon={ShieldCheck} label="Paid (all companies)" value={<UsdcAmount value={sumUsdc(payrolls.filter((p) => p.status === 'executed' && !p.demo).map((p) => p.totalUsdc))} />} />
      </div>
      <Card>
        <CardHeader title="Payroll contract" subtitle="Platform-level controls are held by the contract owner wallet" />
        <div className="space-y-2 p-5 text-sm">
          {PAYROLL_ADDRESS ? (
            <>
              <p>Address: <a className="font-mono text-electric-600 hover:underline" href={addressUrl(PAYROLL_ADDRESS)} target="_blank" rel="noopener noreferrer">{PAYROLL_ADDRESS}</a></p>
              <p>Owner: <span className="font-mono">{contract.data?.owner ?? '...'}</span></p>
              <p className="flex gap-2">State: <Badge tone={contract.data?.paused ? 'danger' : 'success'}>{contract.data?.paused ? 'Paused' : 'Active'}</Badge><Badge>{contract.data?.open ? 'Registration open' : 'Registration closed'}</Badge></p>
            </>
          ) : <p className="text-navy-400">No contract configured.</p>}
        </div>
      </Card>
      <Card>
        <CardHeader title="Companies" />
        {companies.length === 0 ? <EmptyState icon={Building2} title="No companies" text="Companies registered in this workspace appear here." /> : (
          <div className="overflow-x-auto"><table className="w-full"><thead><tr><Th>Company</Th><Th>Country</Th><Th>Employees</Th><Th>Payrolls</Th><Th>Created</Th></tr></thead>
            <tbody className="divide-y divide-navy-100">{companies.map((c) => <tr key={c.id}><Td className="font-medium text-navy-900">{c.name}</Td><Td>{c.country}</Td><Td>{employees.filter((e) => e.companyId === c.id).length}</Td><Td>{payrolls.filter((p) => p.companyId === c.id).length}</Td><Td>{fmtDate(c.createdAt)}</Td></tr>)}</tbody></table></div>
        )}
      </Card>
      <Card>
        <CardHeader title="Audit log" subtitle="Latest 25 actions across all companies" />
        <ul className="divide-y divide-navy-100">{logs.map((l) => <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><span><b className="font-medium">{l.action}</b> <span className="text-navy-400">{l.detail}</span></span><span className="text-xs text-navy-300">{l.actorEmail} · {fmtDateTime(l.createdAt)}</span></li>)}</ul>
      </Card>
    </div>
  )
}
