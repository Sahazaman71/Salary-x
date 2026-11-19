import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ChevronDown,
  Globe2,
  KeyRound,
  Landmark,
  LockKeyhole,
  ScrollText,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react'
import { NetworkArc, TokenUSDC } from '@web3icons/react'
import { Logo } from '@/components/AppShell'
import { Button } from '@/components/ui'
import { useAuth } from '@/lib/auth'

const fade = { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-60px' }, transition: { duration: 0.5 } }

const STEPS = [
  { icon: Users, title: 'Add your team', text: 'Import employees by CSV or add them one by one. Employees submit their own wallet, and you approve it.' },
  { icon: Landmark, title: 'Prefund a budget', text: 'Deposit USDC into the payroll contract and set a monthly allowance. Salaries can never exceed it.' },
  { icon: ScrollText, title: 'Queue the payroll', text: 'Review the totals, approve, and sign once. The batch is reserved onchain for its pay date.' },
  { icon: Zap, title: 'Paid on schedule', text: 'An authorized keeper releases due batches automatically. Every payment is verified onchain.' },
]

const FEATURES = [
  { icon: Landmark, title: 'Prepaid monthly budget', text: 'Fund once, pay monthly. The contract enforces your budget and allowance on every release.' },
  { icon: Globe2, title: 'Multi-currency display', text: 'See salaries in USD, EUR, GBP, BDT, INR, PHP and AUD. Settlement is always USDC.' },
  { icon: CalendarClock, title: 'Scheduled payroll', text: 'Daily, weekly and monthly schedules with reminders and a keeper that runs due batches.' },
  { icon: BadgeCheck, title: 'Verified payments', text: 'A payment is only marked paid after its receipt and events match the approved payroll.' },
  { icon: ScrollText, title: 'Digital payslips', text: 'Employees download PDF payslips with a link to the onchain transaction.' },
  { icon: KeyRound, title: 'Role-based access', text: 'Company admins, payroll managers and employees each see only what they need.' },
]

const FAQ = [
  { q: 'Do employees receive local currency in their bank?', a: 'No. SalaryX settles in USDC on Arc. Currency conversions are shown as estimates only, and local bank payouts would need a licensed payment partner.' },
  { q: 'What stops a payroll from overspending?', a: 'The contract holds your prepaid budget and a monthly allowance. A batch that exceeds either is rejected, and each wallet can be paid once per month.' },
  { q: 'Who can move the money?', a: 'Only the company admin withdraws budget. Managers queue batches. The keeper wallet can only release batches that a manager already created, and only after their pay date.' },
  { q: 'Is personal data stored onchain?', a: 'Never. The contract stores wallet addresses, amounts and an opaque reference. Names and emails stay off-chain.' },
  { q: 'Is this ready for production?', a: 'This build runs on Arc Testnet. Connected to Supabase it uses real accounts with row level security; without it, it falls back to a browser-only demo sign-in. Get the contract independently audited before mainnet.' },
]

export default function Landing() {
  const { user } = useAuth()
  const [open, setOpen] = useState<number | null>(0)
  const cta = user ? { to: '/app', label: 'Open dashboard' } : { to: '/register', label: 'Start free on testnet' }
  return (
    <div className="bg-white text-navy-900">
      <header className="sticky top-0 z-30 border-b border-navy-100 bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Logo />
          <nav className="hidden items-center gap-8 text-sm font-medium text-navy-500 md:flex">
            <a href="#how" className="hover:text-navy-900">How it works</a>
            <a href="#features" className="hover:text-navy-900">Features</a>
            <a href="#arc" className="hover:text-navy-900">Arc</a>
            <a href="#security" className="hover:text-navy-900">Security</a>
            <a href="#faq" className="hover:text-navy-900">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            {!user && (
              <Link to="/login" className="hidden h-10 items-center rounded-xl px-4 text-sm font-medium text-navy-700 hover:bg-navy-50 sm:inline-flex">
                Sign in
              </Link>
            )}
            <Link to={cta.to} className="inline-flex h-10 items-center rounded-xl bg-navy-900 px-4 text-sm font-medium text-white hover:bg-navy-800">
              {user ? cta.label : 'Get started'}
            </Link>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(60%_60%_at_70%_0%,rgba(47,98,255,0.12),transparent)]" />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:py-24">
          <motion.div {...fade}>
            <span className="inline-flex items-center gap-2 rounded-full border border-electric-100 bg-electric-50 px-3 py-1 text-xs font-medium text-electric-700">
              <NetworkArc variant="branded" size={14} /> Payroll on Arc, paid in USDC
            </span>
            <h1 className="mt-5 font-display text-5xl font-semibold leading-[1.05] tracking-[-0.03em] sm:text-6xl">
              Global Payroll. <span className="text-electric-500">Simplified.</span>
            </h1>
            <p className="mt-5 max-w-lg text-lg text-navy-500">
              Prefund a monthly budget, queue salaries once, and let SalaryX pay your worldwide team in USDC on schedule, with every payment verified onchain.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to={cta.to} className="inline-flex h-12 items-center gap-2 rounded-xl bg-electric-500 px-6 font-medium text-white shadow-sm hover:bg-electric-600">
                {cta.label} <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#how" className="inline-flex h-12 items-center rounded-xl border border-navy-200 px-6 font-medium text-navy-800 hover:bg-navy-50">
                See how it works
              </a>
            </div>
            <p className="mt-4 text-xs text-navy-400">Runs on Arc Testnet. No bank payouts. Currency conversions are estimates.</p>
          </motion.div>

          <motion.div {...fade} transition={{ duration: 0.6, delay: 0.1 }} aria-hidden>
            <div className="rounded-3xl border border-navy-100 bg-white p-5 shadow-pop">
              <div className="flex items-center justify-between">
                <span className="font-display font-semibold">Payroll overview</span>
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">Illustration</span>
              </div>
              <div className="mt-5 rounded-2xl bg-navy-900 p-5 text-white">
                <p className="text-xs text-navy-300">Prefunded budget</p>
                <p className="mt-1 flex items-center gap-2 font-display text-3xl font-semibold"><TokenUSDC variant="branded" size={26} /> USDC</p>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full w-2/3 rounded-full bg-electric-400" /></div>
                <p className="mt-2 text-xs text-navy-300">Monthly allowance in use</p>
              </div>
              <div className="mt-4 space-y-2">
                {['Queued for the 1st', 'Released by keeper', 'Verified onchain'].map((t, i) => (
                  <div key={t} className="flex items-center justify-between rounded-xl border border-navy-100 px-4 py-3 text-sm">
                    <span className="flex items-center gap-2 font-medium text-navy-700"><BadgeCheck className="h-4 w-4 text-electric-500" />{t}</span>
                    <span className={`h-2 w-2 rounded-full ${i === 2 ? 'bg-emerald-500' : 'bg-electric-400'}`} />
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      <section id="how" className="border-y border-navy-100 bg-navy-50/60 py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fade}>
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">How SalaryX works</h2>
            <p className="mt-2 max-w-xl text-navy-500">From team setup to verified payment in four steps.</p>
          </motion.div>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <motion.div key={s.title} {...fade} transition={{ duration: 0.45, delay: i * 0.07 }} className="rounded-2xl border border-navy-100 bg-white p-6 shadow-card">
                <div className="flex items-center justify-between">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-electric-50 text-electric-600"><s.icon className="h-5 w-5" /></span>
                  <span className="font-display text-sm text-navy-300">0{i + 1}</span>
                </div>
                <h3 className="mt-5 font-display text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-navy-500">{s.text}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="features" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.div {...fade}>
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Built for global teams</h2>
            <p className="mt-2 max-w-xl text-navy-500">Everything you need to run payroll across borders, with fewer moving parts.</p>
          </motion.div>
          <div className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <motion.div key={f.title} {...fade} className="flex gap-4">
                <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-900 text-white"><f.icon className="h-5 w-5" /></span>
                <div>
                  <h3 className="font-display font-semibold">{f.title}</h3>
                  <p className="mt-1 text-sm text-navy-500">{f.text}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="arc" className="bg-navy-900 py-20 text-white">
        <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-2">
          <motion.div {...fade}>
            <span className="inline-flex items-center gap-2 text-sm text-electric-300"><NetworkArc variant="branded" size={18} /> Arc Network</span>
            <h2 className="mt-3 font-display text-3xl font-semibold tracking-tight sm:text-4xl">USDC is the gas. Payroll costs stay predictable.</h2>
            <p className="mt-4 max-w-lg text-navy-200">
              Arc uses USDC for fees, so your team and your treasury only ever hold one asset. Fast finality means a released payroll is confirmed in moments.
            </p>
          </motion.div>
          <motion.ul {...fade} className="space-y-3">
            {['One asset for salary and fees', 'Sub-second confirmation of released batches', 'Explorer links for every payment', 'Same contract rules for every company'].map((t) => (
              <li key={t} className="flex items-center gap-3 rounded-2xl bg-white/5 px-5 py-4 text-sm"><BadgeCheck className="h-5 w-5 text-electric-300" />{t}</li>
            ))}
          </motion.ul>
        </div>
      </section>

      <section id="security" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <motion.h2 {...fade} className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">Security you can inspect</motion.h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              { icon: LockKeyhole, t: 'Capped by design', d: 'Budget, monthly allowance and one-payment-per-month rules live in the contract, not in a dashboard.' },
              { icon: KeyRound, t: 'Least-privilege keeper', d: 'The automation wallet can only release batches your managers already queued, after their date.' },
              { icon: ShieldCheck, t: 'No personal data onchain', d: 'Only addresses and amounts are public. Names, emails and payslips stay off-chain.' },
            ].map((c) => (
              <motion.div key={c.t} {...fade} className="rounded-2xl border border-navy-100 p-6 shadow-card">
                <c.icon className="h-6 w-6 text-electric-500" />
                <h3 className="mt-4 font-display text-lg font-semibold">{c.t}</h3>
                <p className="mt-2 text-sm text-navy-500">{c.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-navy-100 bg-navy-50/60 py-20">
        <div className="mx-auto max-w-3xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-semibold tracking-tight">Frequently asked questions</h2>
          <div className="mt-8 divide-y divide-navy-100 rounded-2xl border border-navy-100 bg-white">
            {FAQ.map((f, i) => (
              <div key={f.q}>
                <button onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-4 text-left font-medium">
                  {f.q}
                  <ChevronDown className={`h-5 w-5 shrink-0 text-navy-400 transition ${open === i ? 'rotate-180' : ''}`} />
                </button>
                {open === i && <p className="px-5 pb-5 text-sm text-navy-500">{f.a}</p>}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="mx-auto max-w-4xl px-4 text-center sm:px-6">
          <h2 className="font-display text-4xl font-semibold tracking-tight">Pay your world, once a month, on autopilot.</h2>
          <p className="mx-auto mt-3 max-w-lg text-navy-500">Create a company, fund a budget with test USDC, and run your first payroll in minutes.</p>
          <Link to={cta.to}><Button size="lg" variant="electric" className="mt-8">{cta.label}<ArrowRight className="h-4 w-4" /></Button></Link>
        </div>
      </section>

      <footer className="border-t border-navy-100 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-4 text-sm text-navy-400 sm:flex-row sm:px-6">
          <Logo />
          <p>Global Payroll. Simplified. Arc Testnet build. Not financial or legal advice.</p>
        </div>
      </footer>
    </div>
  )
}
