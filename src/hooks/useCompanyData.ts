import { useMemo } from 'react'
import { useAuth } from '@/lib/auth'
import { useTable } from '@/lib/store'
import { sumUsdc } from '@/lib/payroll'

/** Everything a company screen needs, filtered to the signed-in company. */
export function useCompanyData() {
  const { company } = useAuth()
  const employees = useTable('employees')
  const payrolls = useTable('payrolls')
  const items = useTable('payrollItems')
  const transactions = useTable('transactions')
  const schedules = useTable('schedules')
  const members = useTable('members')

  return useMemo(() => {
    const id = company?.id
    const emps = employees.filter((e) => e.companyId === id)
    const pays = payrolls.filter((p) => p.companyId === id).sort((a, b) => b.createdAt - a.createdAt)
    const payIds = new Set(pays.map((p) => p.id))
    const txs = transactions.filter((t) => t.companyId === id).sort((a, b) => b.createdAt - a.createdAt)
    return {
      company,
      employees: emps,
      activeEmployees: emps.filter((e) => e.status === 'active'),
      payrolls: pays,
      items: items.filter((i) => payIds.has(i.payrollId)),
      transactions: txs,
      schedules: schedules.filter((s) => s.companyId === id),
      members: members.filter((m) => m.companyId === id),
      paidTotal: sumUsdc(pays.filter((p) => p.status === 'executed' && !p.demo).map((p) => p.totalUsdc)),
    }
  }, [company, employees, payrolls, items, transactions, schedules, members])
}
