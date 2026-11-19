import { useNavigate, useParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button, Card, Field, Input, Notice, PageHeader, Select } from '@/components/ui'
import { EstimateNotice } from '@/components/shared'
import { useAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { db, newId } from '@/lib/store'
import { CURRENCIES } from '@/lib/types'
import { COUNTRIES, COUNTRY_CURRENCY, isValidWallet, nowMs } from '@/lib/utils'

const schema = z.object({
  name: z.string().trim().min(2, 'Enter the full name'),
  email: z.string().trim().email('Enter a valid email'),
  country: z.string().min(1, 'Select a country'),
  wallet: z.string().trim().optional().refine((v) => !v || isValidWallet(v), 'Not a valid wallet address'),
  salaryAmount: z.string().trim().refine((v) => /^\d+(\.\d{1,6})?$/.test(v) && Number(v) > 0, 'Enter a positive amount (up to 6 decimals)'),
  currency: z.enum(CURRENCIES),
  status: z.enum(['active', 'inactive', 'invited']),
})
type FormValues = z.infer<typeof schema>

export default function EmployeeForm() {
  const { id } = useParams()
  const nav = useNavigate()
  const { user, company } = useAuth()
  const existing = id ? db.employees.get(id) : undefined
  const { register, handleSubmit, setError, setValue, formState } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: existing
      ? { name: existing.name, email: existing.email, country: existing.country, wallet: existing.wallet ?? '', salaryAmount: existing.salaryAmount, currency: existing.currency, status: existing.status }
      : { country: 'United States', currency: company?.defaultCurrency ?? 'USD', status: 'invited', wallet: '' },
  })

  if (id && (!existing || existing.companyId !== company?.id)) {
    return <Notice tone="danger" title="Employee not found">This employee does not exist in your company.</Notice>
  }

  const submit = handleSubmit((v) => {
    if (!company) return
    const email = v.email.toLowerCase()
    const dup = db.employees.where((e) => e.companyId === company.id && e.email.toLowerCase() === email && e.id !== id)[0]
    if (dup) return setError('email', { message: 'An employee with this email already exists' })
    const wallet = v.wallet || undefined
    const walletChanged = wallet?.toLowerCase() !== existing?.wallet?.toLowerCase()
    const patch = {
      name: v.name,
      email,
      country: v.country,
      wallet,
      // A wallet entered by an admin or manager is trusted. Clearing it resets the status.
      walletStatus: wallet ? ('approved' as const) : ('none' as const),
      salaryAmount: v.salaryAmount,
      currency: v.currency,
      status: v.status,
    }
    if (existing) {
      db.employees.update(existing.id, patch)
      logAudit(user, 'employee.updated', 'employee', `${email}${walletChanged ? ' (wallet changed)' : ''}`, company.id)
      toast.success('Employee updated')
    } else {
      db.employees.insert({ id: newId(), companyId: company.id, createdAt: nowMs(), ...patch })
      logAudit(user, 'employee.created', 'employee', email, company.id)
      toast.success('Employee added. They can now register with this email.')
    }
    void nav('/app/employees')
  })

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={existing ? 'Edit employee' : 'Add employee'} subtitle="Employees register with this email to see their salary and submit a wallet." />
      <Card className="p-6">
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" error={formState.errors.name?.message}><Input {...register('name')} /></Field>
            <Field label="Email" error={formState.errors.email?.message}><Input type="email" {...register('email')} /></Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Country" error={formState.errors.country?.message}>
              <Select {...register('country', { onChange: (e: React.ChangeEvent<HTMLSelectElement>) => { const c = COUNTRY_CURRENCY[e.target.value]; if (c) setValue('currency', c as FormValues['currency']) } })}>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Status"><Select {...register('status')}><option value="invited">Invited</option><option value="active">Active</option><option value="inactive">Inactive</option></Select></Field>
          </div>
          <Field label="Wallet address (Arc)" error={formState.errors.wallet?.message} hint="Optional. Leave empty to let the employee submit it. Check the address carefully: payments are irreversible.">
            <Input className="font-mono" placeholder="0x..." {...register('wallet')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
            <Field label="Salary per month" error={formState.errors.salaryAmount?.message}><Input inputMode="decimal" placeholder="1200" {...register('salaryAmount')} /></Field>
            <Field label="Currency"><Select {...register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          </div>
          <EstimateNotice />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => void nav('/app/employees')}>Cancel</Button>
            <Button type="submit" variant="electric" loading={formState.isSubmitting}>{existing ? 'Save changes' : 'Add employee'}</Button>
          </div>
        </form>
      </Card>
    </div>
  )
}
