import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { clearAll, db, getJson, newId, removeJson, setJson, useJsonRaw, useTable } from './store'
import { logAudit } from './audit'
import { newOnchainId } from './payroll'
import { initRemote, pullAll } from './remote'
import { backendMode, supabase } from './supabase'
import type { Company, Currency, Profile, Role } from './types'

/**
 * Two modes, chosen by environment variables:
 * - Supabase mode (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY): real accounts with Supabase Auth.
 *   Roles are assigned by a database trigger at sign-up and enforced by row level security.
 * - Local demo mode: accounts live in this browser only, so roles are NOT a security boundary.
 */

const enc = new TextEncoder()
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')

async function hashPassword(password: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: 120_000, hash: 'SHA-256' }, key, 256)
  return toHex(bits)
}

const platformAdmins = (): string[] =>
  ((import.meta.env.VITE_PLATFORM_ADMIN_EMAILS as string | undefined) ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)

export interface RegisterInput {
  email: string
  password: string
  fullName: string
  /** 'company' creates a new company. 'invited' joins as an invited manager or employee. */
  kind: 'company' | 'invited'
  companyName?: string
  country?: string
  currency?: Currency
}

interface AuthValue {
  user?: Profile
  company?: Company
  role?: Role
  /** True while the first session check and data load are running (Supabase mode). */
  loading: boolean
  mode: 'supabase' | 'local'
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<{ needsConfirmation: boolean }>
  logout: () => void
}

const Ctx = createContext<AuthValue | null>(null)

function friendlyAuthError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('database error saving new user') || m.includes('no invitation')) return 'No invitation found for this email. Ask your company admin to add you first.'
  if (m.includes('already registered') || m.includes('already been registered')) return 'An account with this email already exists.'
  if (m.includes('email not confirmed')) return 'Confirm your email first. Check your inbox for the link.'
  if (m.includes('invalid login')) return 'Invalid email or password.'
  if (m.includes('password')) return message
  return 'Something went wrong. Please try again.'
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const profiles = useTable('profiles')
  const companies = useTable('companies')
  const localRaw = useJsonRaw('session')
  const [remoteId, setRemoteId] = useState<string>()
  const [ready, setReady] = useState(backendMode === 'local')

  const sessionId = backendMode === 'supabase' ? remoteId : localRaw ? (JSON.parse(localRaw) as string) : undefined

  // Supabase session lifecycle: restore on load, react to sign in / out, keep data fresh.
  useEffect(() => {
    if (!supabase) return
    initRemote()
    const client = supabase
    void client.auth.getSession().then(async ({ data }) => {
      const id = data.session?.user.id
      if (id) await pullAll()
      setRemoteId(id)
      setReady(true)
    })
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      const id = session?.user.id
      // Defer: awaiting Supabase calls inside this callback can deadlock the auth client.
      setTimeout(() => {
        if (event === 'SIGNED_OUT' || !id) {
          clearAll()
          setRemoteId(undefined)
        } else if (event === 'SIGNED_IN') {
          void pullAll(true).then(() => setRemoteId(id))
        }
      }, 0)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !remoteId) return
    const refresh = () => void pullAll()
    const t = setInterval(refresh, 20_000)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', refresh)
    }
  }, [remoteId])

  const user = useMemo(() => profiles.find((p) => p.id === sessionId), [profiles, sessionId])
  const company = useMemo(() => companies.find((c) => c.id === user?.companyId), [companies, user])

  const login = useCallback(async (email: string, password: string) => {
    if (supabase) {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      if (error) throw new Error(friendlyAuthError(error.message))
      await pullAll(true)
      setRemoteId(data.user.id)
      return
    }
    const p = db.profiles.where((x) => x.email === email.trim().toLowerCase())[0]
    if (!p) throw new Error('Invalid email or password.')
    const hash = await hashPassword(password, p.salt ?? '')
    if (hash !== p.passwordHash) throw new Error('Invalid email or password.')
    setJson('session', p.id)
    logAudit(p, 'login', 'profile', 'Signed in')
  }, [])

  const register = useCallback(async (input: RegisterInput): Promise<{ needsConfirmation: boolean }> => {
    const email = input.email.trim().toLowerCase()

    if (supabase) {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: {
          emailRedirectTo: window.location.origin + '/login',
          // Read by the sign-up trigger. It can only create your own company or claim an invitation for this email.
          data: { full_name: input.fullName.trim(), kind: input.kind, company_name: input.companyName?.trim(), country: input.country, currency: input.currency },
        },
      })
      if (error) throw new Error(friendlyAuthError(error.message))
      if (data.session) {
        await pullAll(true)
        setRemoteId(data.session.user.id)
      }
      return { needsConfirmation: !data.session }
    }

    if (db.profiles.where((x) => x.email === email).length) throw new Error('An account with this email already exists.')
    const salt = newId()
    const base = { id: newId(), email, fullName: input.fullName.trim(), salt, passwordHash: await hashPassword(input.password, salt), createdAt: Date.now() }
    let profile: Profile

    if (platformAdmins().includes(email)) {
      profile = { ...base, role: 'platform_admin' }
      db.profiles.insert(profile)
    } else if (input.kind === 'company') {
      const companyId = newId()
      profile = { ...base, role: 'company_admin', companyId }
      db.profiles.insert(profile)
      db.companies.insert({
        id: companyId,
        name: input.companyName?.trim() || `${base.fullName}'s company`,
        country: input.country ?? 'United States',
        defaultCurrency: input.currency ?? 'USD',
        ownerId: profile.id,
        onchainId: newOnchainId(),
        createdAt: Date.now(),
      })
      db.members.insert({ id: newId(), companyId, email, role: 'company_admin', profileId: profile.id, createdAt: Date.now() })
    } else {
      const invite = db.members.where((m) => m.email === email && !m.profileId)[0]
      const employee = db.employees.where((e) => e.email.toLowerCase() === email && !e.profileId)[0]
      if (invite) {
        profile = { ...base, role: invite.role, companyId: invite.companyId }
        db.profiles.insert(profile)
        db.members.update(invite.id, { profileId: profile.id })
      } else if (employee) {
        profile = { ...base, role: 'employee', companyId: employee.companyId, employeeId: employee.id }
        db.profiles.insert(profile)
        db.employees.update(employee.id, { profileId: profile.id, status: employee.status === 'invited' ? 'active' : employee.status })
      } else {
        throw new Error('No invitation found for this email. Ask your company admin to add you first.')
      }
    }
    setJson('session', profile.id)
    logAudit(profile, 'register', 'profile', `Registered as ${profile.role}`)
    return { needsConfirmation: false }
  }, [])

  const logout = useCallback(() => {
    if (supabase) void supabase.auth.signOut()
    else removeJson('session')
  }, [])

  const value = useMemo<AuthValue>(() => {
    const loading = !ready
    return { user, company, role: user?.role, loading, mode: backendMode, login, register, logout }
  }, [user, company, ready, login, register, logout])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}

export const canManagePayroll = (role?: Role) => role === 'company_admin' || role === 'payroll_manager'

/** Read helper used outside React. */
export const currentSessionId = () => getJson<string>('session')
