import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Building2, MailCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Logo } from '@/components/AppShell'
import { Button, Field, Input, Notice, Select } from '@/components/ui'
import { useAuth } from '@/lib/auth'
import { backendMode } from '@/lib/supabase'
import { CURRENCIES } from '@/lib/types'
import { COUNTRIES, cn } from '@/lib/utils'

const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(1, 'Enter your password'),
})
const registerSchema = z.object({
  kind: z.enum(['company', 'invited']),
  fullName: z.string().trim().min(2, 'Enter your name'),
  email: z.string().trim().email('Enter a valid email'),
  password: z.string().min(8, 'Use at least 8 characters'),
  companyName: z.string().trim().optional(),
  country: z.string().optional(),
  currency: z.enum(CURRENCIES).optional(),
})
type RegisterForm = z.infer<typeof registerSchema>

function DemoAuthNotice() {
  if (backendMode === 'supabase') return null
  return (
    <div className="mt-6">
      <Notice tone="warning" title="Demo sign-in (not connected to Supabase)">
        Accounts are stored in this browser only, so roles are not secure. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to use real accounts.
      </Notice>
    </div>
  )
}

function Shell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.05fr]">
      <div className="flex flex-col px-5 py-8 sm:px-12">
        <Link to="/"><Logo /></Link>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-navy-400">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-navy-900 lg:block">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full bg-electric-500/30 blur-3xl" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <h2 className="font-display text-4xl font-semibold leading-tight tracking-tight">Prefund once.<br />Pay the world monthly.</h2>
          <p className="mt-4 max-w-sm text-navy-200">Budgets and allowances are enforced by the payroll contract on Arc, so salaries can never overspend.</p>
        </div>
      </div>
    </div>
  )
}

export default function Auth({ mode }: { mode: 'login' | 'register' }) {
  return mode === 'login' ? <Login /> : <Register />
}

function Login() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const { register, handleSubmit, formState } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) })
  const submit = handleSubmit(async (v) => {
    setError('')
    try {
      await login(v.email, v.password)
      void nav('/app', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  })
  return (
    <Shell title="Welcome back" subtitle="Sign in to manage payroll or view your salary.">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <Field label="Email" error={formState.errors.email?.message}><Input type="email" autoComplete="email" {...register('email')} /></Field>
        <Field label="Password" error={formState.errors.password?.message}><Input type="password" autoComplete="current-password" {...register('password')} /></Field>
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="electric" className="w-full" loading={formState.isSubmitting}>Sign in</Button>
      </form>
      <p className="mt-6 text-center text-sm text-navy-400">New to SalaryX? <Link to="/register" className="font-medium text-electric-600 hover:underline">Create an account</Link></p>
      <DemoAuthNotice />
    </Shell>
  )
}

function Register() {
  const { register: signUp } = useAuth()
  const nav = useNavigate()
  const [error, setError] = useState('')
  const [confirmEmail, setConfirmEmail] = useState('')
  const { register, handleSubmit, watch, setValue, formState } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { kind: 'company', country: 'United States', currency: 'USD' },
  })
  const kind = watch('kind')
  const submit = handleSubmit(async (v) => {
    setError('')
    if (v.kind === 'company' && !v.companyName?.trim()) {
      setError('Enter your company name.')
      return
    }
    try {
      const r = await signUp({ ...v })
      if (r.needsConfirmation) {
        setConfirmEmail(v.email.trim())
        return
      }
      toast.success('Account created')
      void nav('/app', { replace: true })
    } catch (e) {
      setError((e as Error).message)
    }
  })
  if (confirmEmail) {
    return (
      <Shell title="Check your email" subtitle="One more step before you can sign in.">
        <Notice tone="info" title="Confirm your email">
          We sent a confirmation link to {confirmEmail}. Open it, then sign in.
        </Notice>
        <Link to="/login" className="mt-6 inline-flex h-11 items-center rounded-xl bg-navy-900 px-5 text-sm font-medium text-white hover:bg-navy-800">Go to sign in</Link>
      </Shell>
    )
  }
  return (
    <Shell title="Create your account" subtitle="Set up a company, or join one you were invited to.">
      <form onSubmit={(e) => void submit(e)} className="space-y-4">
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Account type">
          {([
            ['company', 'New company', Building2],
            ['invited', 'I was invited', MailCheck],
          ] as const).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              onClick={() => setValue('kind', k)}
              className={cn('flex h-14 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition', kind === k ? 'border-electric-500 bg-electric-50 text-electric-700' : 'border-navy-200 text-navy-600 hover:bg-navy-50')}
            >
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        <Field label="Full name" error={formState.errors.fullName?.message}><Input autoComplete="name" {...register('fullName')} /></Field>
        <Field label="Work email" error={formState.errors.email?.message} hint={kind === 'invited' ? 'Use the email your admin invited. Employees: the one on your employee record.' : undefined}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field label="Password" error={formState.errors.password?.message}><Input type="password" autoComplete="new-password" {...register('password')} /></Field>
        {kind === 'company' && (
          <>
            <Field label="Company name"><Input {...register('companyName')} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country"><Select {...register('country')}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Display currency"><Select {...register('currency')}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            </div>
          </>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        <Button type="submit" variant="electric" className="w-full" loading={formState.isSubmitting}>Create account</Button>
      </form>
      <p className="mt-6 text-center text-sm text-navy-400">Already have an account? <Link to="/login" className="font-medium text-electric-600 hover:underline">Sign in</Link></p>
      <DemoAuthNotice />
    </Shell>
  )
}
