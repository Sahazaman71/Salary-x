import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Download, Pencil, Search, Trash2, Upload, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Badge, Button, Card, ConfirmDialog, Dialog, EmptyState, Input, Notice, PageHeader, Select, Td, Th } from '@/components/ui'
import { useCompanyData } from '@/hooks/useCompanyData'
import { useAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { EMPLOYEE_CSV_TEMPLATE, parseEmployeesCsv, type CsvParseResult } from '@/lib/csv'
import { db, newId } from '@/lib/store'
import type { Employee } from '@/lib/types'
import { downloadFile, fmtMoney, shortAddress, nowMs } from '@/lib/utils'

function WalletCell({ e, onApprove }: { e: Employee; onApprove: () => void }) {
  if (!e.wallet) return <Badge>No wallet</Badge>
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-xs">{shortAddress(e.wallet)}</span>
      {e.walletStatus === 'pending' ? (
        <Button size="sm" variant="secondary" icon={Check} onClick={onApprove}>Approve</Button>
      ) : (
        <Badge tone="success">Approved</Badge>
      )}
    </div>
  )
}

export default function Employees() {
  const { user, company } = useAuth()
  const { employees } = useCompanyData()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [removing, setRemoving] = useState<Employee>()
  const [importOpen, setImportOpen] = useState(false)

  const shown = employees.filter((e) => {
    const hit = `${e.name} ${e.email} ${e.country}`.toLowerCase().includes(q.toLowerCase())
    return hit && (status === 'all' || e.status === status || (status === 'pending' && e.walletStatus === 'pending'))
  })
  const pending = employees.filter((e) => e.walletStatus === 'pending').length

  const approve = (e: Employee) => {
    db.employees.update(e.id, { walletStatus: 'approved' })
    logAudit(user, 'employee.wallet_approved', 'employee', `Approved wallet ${e.wallet} for ${e.email}`, company?.id)
    toast.success(`Wallet approved for ${e.name}`)
  }
  const remove = () => {
    if (!removing) return
    if (db.payrollItems.where((i) => i.employeeId === removing.id).length > 0) {
      // Payment history must stay intact, so deactivate instead of deleting.
      db.employees.update(removing.id, { status: 'inactive' })
      logAudit(user, 'employee.deactivated', 'employee', removing.email, company?.id)
      toast.success('This employee has payment history, so they were set to inactive instead.')
    } else {
      db.employees.remove(removing.id)
      logAudit(user, 'employee.removed', 'employee', removing.email, company?.id)
      toast.success('Employee removed')
    }
    setRemoving(undefined)
  }

  return (
    <div>
      <PageHeader
        title="Employees"
        subtitle={`${employees.length} on your team`}
        action={
          <div className="flex gap-2">
            <Button variant="secondary" icon={Upload} onClick={() => setImportOpen(true)}>Import CSV</Button>
            <Link to="/app/employees/new"><Button variant="electric" icon={UserPlus}>Add employee</Button></Link>
          </div>
        }
      />
      {pending > 0 && (
        <div className="mb-4"><Notice tone="warning" title={`${pending} wallet${pending > 1 ? 's' : ''} awaiting approval`}>Check each address with the employee, then approve it. Unapproved wallets are never paid.</Notice></div>
      )}
      <Card>
        <div className="flex flex-wrap gap-3 border-b border-navy-100 p-4">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-navy-300" />
            <Input className="pl-9" placeholder="Search name, email or country" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search employees" />
          </div>
          <Select className="w-44" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="invited">Invited</option>
            <option value="pending">Wallet pending</option>
          </Select>
        </div>
        {employees.length === 0 ? (
          <EmptyState icon={Users} title="No employees yet" text="Add your first employee, or import your team from a CSV file." action={<Link to="/app/employees/new"><Button variant="electric" icon={UserPlus}>Add employee</Button></Link>} />
        ) : shown.length === 0 ? (
          <EmptyState icon={Search} title="No matches" text="Try a different search or filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr><Th>Employee</Th><Th>Country</Th><Th>Salary</Th><Th>Wallet</Th><Th>Status</Th><Th /></tr></thead>
              <tbody className="divide-y divide-navy-100">
                {shown.map((e) => (
                  <tr key={e.id} className="hover:bg-navy-50/60">
                    <Td><p className="font-medium text-navy-900">{e.name}</p><p className="text-xs text-navy-400">{e.email}</p></Td>
                    <Td>{e.country}</Td>
                    <Td className="num">{fmtMoney(e.salaryAmount, e.currency)}</Td>
                    <Td><WalletCell e={e} onApprove={() => approve(e)} /></Td>
                    <Td><Badge tone={e.status === 'active' ? 'success' : e.status === 'invited' ? 'info' : 'neutral'}>{e.status}</Badge></Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Link to={`/app/employees/${e.id}`} aria-label={`Edit ${e.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-navy-500 hover:bg-navy-100"><Pencil className="h-4 w-4" /></Link>
                        <button onClick={() => setRemoving(e)} aria-label={`Remove ${e.name}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50"><Trash2 className="h-4 w-4" /></button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!removing} onClose={() => setRemoving(undefined)} onConfirm={remove} title="Remove employee" confirmLabel="Remove" danger>
        <p>Remove <b>{removing?.name}</b> from your team? Past payments stay in your history.</p>
      </ConfirmDialog>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  )
}

function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, company } = useAuth()
  const { employees } = useCompanyData()
  const [result, setResult] = useState<CsvParseResult>()
  const [name, setName] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const close = () => {
    setResult(undefined)
    setName('')
    onClose()
  }
  const onFile = async (f?: File) => {
    if (!f) return
    setName(f.name)
    setResult(parseEmployeesCsv(await f.text()))
  }
  const existing = new Set(employees.map((e) => e.email.toLowerCase()))
  const fresh = result?.valid.filter((r) => !existing.has(r.email)) ?? []
  const skipped = (result?.valid.length ?? 0) - fresh.length

  const doImport = () => {
    if (!company) return
    fresh.forEach((r) =>
      db.employees.insert({
        id: newId(),
        companyId: company.id,
        name: r.name,
        email: r.email,
        country: r.country,
        wallet: r.wallet,
        walletStatus: r.wallet ? 'approved' : 'none',
        salaryAmount: r.salary,
        currency: r.currency,
        status: 'invited',
        createdAt: nowMs(),
      }),
    )
    logAudit(user, 'employee.imported', 'employee', `${fresh.length} employees imported from CSV`, company.id)
    toast.success(`${fresh.length} employees imported`)
    close()
  }

  return (
    <Dialog open={open} onClose={close} title="Import employees from CSV" wide>
      <div className="space-y-4">
        <p className="text-sm text-navy-500">Columns: name, email, country, wallet (optional), salary, currency. Wallets you include are treated as approved.</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={Download} onClick={() => downloadFile('salaryx-employees-template.csv', EMPLOYEE_CSV_TEMPLATE)}>Download template</Button>
          <Button variant="secondary" icon={Upload} onClick={() => input.current?.click()}>{name || 'Choose file'}</Button>
          <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {result && (
          <div className="space-y-3">
            <Notice tone={fresh.length ? 'info' : 'warning'}>
              {fresh.length} ready to import{skipped ? `, ${skipped} already on your team` : ''}{result.errors.length ? `, ${result.errors.length} with errors` : ''}.
            </Notice>
            {result.errors.length > 0 && (
              <ul className="max-h-40 space-y-1 overflow-y-auto rounded-xl border border-red-100 bg-red-50 p-3 text-xs text-red-800">
                {result.errors.map((e) => <li key={e.line}>Line {e.line}: {e.message}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>Cancel</Button>
          <Button variant="electric" disabled={!fresh.length} onClick={doImport}>Import {fresh.length || ''}</Button>
        </div>
      </div>
    </Dialog>
  )
}
