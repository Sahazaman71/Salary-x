import { useState } from 'react'
import { toast } from 'sonner'
import { Trash2, UserPlus } from 'lucide-react'
import { Badge, Button, Card, CardHeader, Field, Input, PageHeader, Select, Td, Th, Notice } from '@/components/ui'
import { useCompanyData } from '@/hooks/useCompanyData'
import { useAuth } from '@/lib/auth'
import { logAudit } from '@/lib/audit'
import { opSetManager, verifyEvent } from '@/lib/chain'
import { runTx } from '@/lib/tx'
import { getSettings, updateSettings, useSettings } from '@/lib/settings'
import { db, newId, useTable } from '@/lib/store'
import { CURRENCIES, type Currency } from '@/lib/types'
import { COUNTRIES, fmtDateTime, isValidWallet, shortAddress, nowMs } from '@/lib/utils'
import type { Address } from 'viem'

export default function Settings() {
  const { user, company } = useAuth()
  const d = useCompanyData()
  const settings = useSettings()
  const logs = useTable('auditLogs').filter((l) => l.companyId === company?.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
  const [name, setName] = useState(company?.name ?? '')
  const [country, setCountry] = useState(company?.country ?? 'United States')
  const [currency, setCurrency] = useState<Currency>(company?.defaultCurrency ?? 'USD')
  const [email, setEmail] = useState('')
  const [wallet, setWallet] = useState('')
  const [busy, setBusy] = useState<string>()
  if (!company || !user) return null

  const save = () => {
    db.companies.update(company.id, { name: name.trim() || company.name, country, defaultCurrency: currency })
    logAudit(user, 'company.updated', 'company', name, company.id)
    toast.success('Company saved')
  }

  const invite = () => {
    const e = email.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(e)) return toast.error('Enter a valid email')
    if (wallet && !isValidWallet(wallet)) return toast.error('Enter a valid wallet address')
    if (db.members.where((m) => m.companyId === company.id && m.email === e).length) return toast.error('That email is already a member')
    db.members.insert({ id: newId(), companyId: company.id, email: e, role: 'payroll_manager', wallet: wallet || undefined, createdAt: nowMs() })
    logAudit(user, 'member.invited', 'member', e, company.id)
    toast.success('Manager invited. They register with this email.')
    setEmail(''); setWallet('')
  }

  const grant = async (id: string, w: string, enabled: boolean) => {
    setBusy(id)
    const r = await runTx({ companyId: company.id, kind: 'set_manager', amountUsdc: '0', user }, (h) => opSetManager(company.onchainId, w as Address, enabled, h), verifyEvent('ManagerSet'))
    setBusy(undefined)
    if (r.ok) toast.success(enabled ? 'Manager wallet authorized onchain' : 'Manager wallet removed onchain')
    else if (!r.cancelled) toast.error(r.error ?? 'Failed')
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Company settings" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Company profile" />
          <div className="space-y-4 p-5">
            <Field label="Company name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Country"><Select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
              <Field label="Display currency"><Select value={currency} onChange={(e) => setCurrency(e.target.value as Currency)}>{CURRENCIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            </div>
            <Button variant="electric" onClick={save}>Save</Button>
          </div>
        </Card>
        <Card>
          <CardHeader title="Demo mode" subtitle="Simulate payments without sending anything onchain" />
          <div className="space-y-4 p-5">
            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium">
              <input type="checkbox" className="h-5 w-5 accent-electric-500" checked={settings.demoMode} onChange={(e) => { updateSettings({ demoMode: e.target.checked }); toast(e.target.checked ? 'Demo mode on' : 'Demo mode off') }} />
              Enable demo mode
            </label>
            <Notice tone="demo">Simulated actions are labelled DEMO everywhere and are never marked confirmed. Currently {getSettings().demoMode ? 'on' : 'off'}.</Notice>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title="Payroll managers" subtitle="Managers can queue payrolls. Authorize their wallet onchain so the contract accepts them." />
        <div className="grid gap-3 border-b border-navy-100 p-5 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="Manager email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Manager wallet (optional)"><Input className="font-mono" placeholder="0x..." value={wallet} onChange={(e) => setWallet(e.target.value.trim())} /></Field>
          <Button variant="electric" icon={UserPlus} onClick={invite}>Invite</Button>
        </div>
        <div className="overflow-x-auto"><table className="w-full"><thead><tr><Th>Email</Th><Th>Role</Th><Th>Wallet</Th><Th /></tr></thead>
          <tbody className="divide-y divide-navy-100">
            {d.members.map((m) => (
              <tr key={m.id}>
                <Td className="font-medium text-navy-900">{m.email}</Td>
                <Td><Badge tone={m.role === 'company_admin' ? 'info' : 'neutral'}>{m.role === 'company_admin' ? 'Admin' : 'Manager'}</Badge>{!m.profileId && <span className="ml-2 text-xs text-amber-700">invited</span>}</Td>
                <Td className="font-mono text-xs">{shortAddress(m.wallet) || '-'}</Td>
                <Td>
                  {m.role === 'payroll_manager' && (
                    <div className="flex justify-end gap-1.5">
                      {m.wallet && <Button size="sm" variant="secondary" loading={busy === m.id} onClick={() => void grant(m.id, m.wallet as string, true)}>Authorize onchain</Button>}
                      <button aria-label={`Remove ${m.email}`} className="flex h-9 w-9 items-center justify-center rounded-lg text-red-600 hover:bg-red-50" onClick={() => { if (m.wallet) void grant(m.id, m.wallet, false); db.members.remove(m.id) }}><Trash2 className="h-4 w-4" /></button>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </tbody></table></div>
      </Card>

      <Card>
        <CardHeader title="Audit log" subtitle="Latest important actions" />
        <ul className="divide-y divide-navy-100">
          {logs.length === 0 ? <li className="p-5 text-sm text-navy-400">No activity yet.</li> : logs.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm"><span><b className="font-medium">{l.action}</b> <span className="text-navy-400">{l.detail}</span></span><span className="text-xs text-navy-300">{l.actorEmail} · {fmtDateTime(l.createdAt)}</span></li>
          ))}
        </ul>
      </Card>
    </div>
  )
}
