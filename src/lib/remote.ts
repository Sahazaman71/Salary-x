import { toast } from 'sonner'
import { hydrate, setRemote, type TableName } from './store'
import { supabase } from './supabase'

/** Column kinds: s string, ms timestamp (ms <-> timestamptz), n numeric kept as a string, i integer, b boolean, a array, u uuid-or-null. */
type Kind = 's' | 'ms' | 'n' | 'i' | 'b' | 'a' | 'u'
type Spec = [camel: string, snake: string, kind: Kind][]

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const TABLES: Record<TableName, { name: string; cols: Spec; writable: boolean; order?: string; limit?: number }> = {
  profiles: {
    name: 'profiles',
    writable: false, // created by a database trigger at sign-up, never by the browser
    cols: [['id', 'id', 'u'], ['email', 'email', 's'], ['fullName', 'full_name', 's'], ['role', 'role', 's'], ['companyId', 'company_id', 'u'], ['createdAt', 'created_at', 'ms']],
  },
  companies: {
    name: 'companies',
    writable: true,
    cols: [['id', 'id', 'u'], ['name', 'name', 's'], ['country', 'country', 's'], ['defaultCurrency', 'default_currency', 's'], ['ownerId', 'owner_id', 'u'], ['onchainId', 'onchain_id', 's'], ['createdAt', 'created_at', 'ms']],
  },
  members: {
    name: 'company_members',
    writable: true,
    cols: [['id', 'id', 'u'], ['companyId', 'company_id', 'u'], ['email', 'email', 's'], ['role', 'role', 's'], ['profileId', 'profile_id', 'u'], ['wallet', 'wallet', 's'], ['createdAt', 'created_at', 'ms']],
  },
  employees: {
    name: 'employees',
    writable: true,
    cols: [['id', 'id', 'u'], ['companyId', 'company_id', 'u'], ['profileId', 'profile_id', 'u'], ['name', 'name', 's'], ['email', 'email', 's'], ['country', 'country', 's'], ['wallet', 'wallet', 's'], ['walletStatus', 'wallet_status', 's'], ['salaryAmount', 'salary_amount', 'n'], ['currency', 'currency', 's'], ['status', 'status', 's'], ['createdAt', 'created_at', 'ms']],
  },
  payrolls: {
    name: 'payrolls',
    writable: true,
    cols: [['id', 'id', 'u'], ['companyId', 'company_id', 'u'], ['title', 'title', 's'], ['period', 'period', 'i'], ['executeAfter', 'execute_after', 'ms'], ['status', 'status', 's'], ['totalUsdc', 'total_usdc', 'n'], ['onchainBatchId', 'onchain_batch_id', 'n'], ['demo', 'demo', 'b'], ['scheduleId', 'schedule_id', 'u'], ['createdBy', 'created_by', 'u'], ['createdAt', 'created_at', 'ms']],
  },
  payrollItems: {
    name: 'payroll_items',
    writable: true,
    cols: [['id', 'id', 'u'], ['payrollId', 'payroll_id', 'u'], ['employeeId', 'employee_id', 'u'], ['wallet', 'wallet', 's'], ['amountUsdc', 'amount_usdc', 'n'], ['displayAmount', 'display_amount', 'n'], ['displayCurrency', 'display_currency', 's']],
  },
  transactions: {
    name: 'payment_transactions',
    writable: true,
    order: 'created_at',
    limit: 2000,
    cols: [['id', 'id', 'u'], ['companyId', 'company_id', 'u'], ['payrollId', 'payroll_id', 'u'], ['kind', 'kind', 's'], ['hash', 'hash', 's'], ['status', 'status', 's'], ['amountUsdc', 'amount_usdc', 'n'], ['blockNumber', 'block_number', 'n'], ['verified', 'verified', 'b'], ['error', 'error', 's'], ['createdBy', 'created_by', 'u'], ['createdAt', 'created_at', 'ms']],
  },
  schedules: {
    name: 'payroll_schedules',
    writable: true,
    cols: [['id', 'id', 'u'], ['companyId', 'company_id', 'u'], ['name', 'name', 's'], ['frequency', 'frequency', 's'], ['anchor', 'anchor', 'i'], ['active', 'active', 'b'], ['employeeIds', 'employee_ids', 'a'], ['createdAt', 'created_at', 'ms']],
  },
  auditLogs: {
    name: 'audit_logs',
    writable: true,
    order: 'created_at',
    limit: 500,
    cols: [['id', 'id', 'u'], ['companyId', 'company_id', 'u'], ['actorId', 'actor_id', 'u'], ['actorEmail', 'actor_email', 's'], ['action', 'action', 's'], ['entity', 'entity', 's'], ['detail', 'detail', 's'], ['createdAt', 'created_at', 'ms']],
  },
}

function toDb(kind: Kind, v: unknown): unknown {
  if (v === undefined || v === null || v === '') return null
  switch (kind) {
    case 'ms':
      return new Date(v as number).toISOString()
    case 'n':
      return String(v)
    case 'u':
      return typeof v === 'string' && UUID.test(v) ? v : null
    default:
      return v
  }
}

function fromDb(kind: Kind, v: unknown): unknown {
  if (v === null || v === undefined) return undefined
  switch (kind) {
    case 'ms':
      return Date.parse(v as string)
    case 'n':
      return String(v)
    default:
      return v
  }
}

function toRow(spec: Spec, obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [camel, snake, kind] of spec) {
    if (camel in obj) out[snake] = toDb(kind, obj[camel])
  }
  return out
}

function fromRow(spec: Spec, row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [camel, snake, kind] of spec) {
    const v = fromDb(kind, row[snake])
    if (v !== undefined) out[camel] = v
  }
  return out
}

let pending = 0
let chain: Promise<unknown> = Promise.resolve()
let lastWarn = 0

/** Writes run one at a time, in order, so foreign keys (payroll before its items) always hold. */
function enqueue(label: string, fn: () => Promise<{ error: { message: string } | null }>) {
  pending++
  chain = chain
    .then(fn)
    .then((res) => {
      if (res.error) throw new Error(res.error.message)
    })
    .catch((e: Error) => {
      if (Date.now() - lastWarn > 2000) {
        toast.error(`Could not save ${label}: ${e.message}`)
        lastWarn = Date.now()
      }
      return pullAll(true) // roll the screen back to what the server holds
    })
    .finally(() => {
      pending--
    })
}

export async function pullAll(force = false): Promise<void> {
  const client = supabase
  if (!client) return
  if (pending > 0 && !force) return
  const names = Object.keys(TABLES) as TableName[]
  await Promise.all(
    names.map(async (n) => {
      const t = TABLES[n]
      let q = client.from(t.name).select('*')
      if (t.order) q = q.order(t.order, { ascending: false }).limit(t.limit ?? 1000)
      const { data, error } = await q
      if (error || !data) return
      hydrate(n, (data as Record<string, unknown>[]).map((r) => fromRow(t.cols, r)))
    }),
  )
}

export function initRemote() {
  if (!supabase) return
  const client = supabase
  setRemote({
    insert: (n, row) => {
      const t = TABLES[n]
      if (!t.writable) return
      enqueue(t.name, async () => client.from(t.name).insert(toRow(t.cols, row as Record<string, unknown>)))
    },
    update: (n, id, patch) => {
      const t = TABLES[n]
      if (!t.writable) return
      const body = toRow(t.cols, patch as Record<string, unknown>)
      if (Object.keys(body).length === 0) return
      enqueue(t.name, async () => client.from(t.name).update(body).eq('id', id))
    },
    remove: (n, id) => {
      const t = TABLES[n]
      if (!t.writable) return
      enqueue(t.name, async () => client.from(t.name).delete().eq('id', id))
    },
  })
}

/** Employee submits their payout wallet. Done through a server function so they can touch nothing else. */
export async function submitWalletRemote(wallet: string): Promise<string | undefined> {
  if (!supabase) return undefined
  const { error } = await supabase.rpc('submit_my_wallet', { addr: wallet })
  return error?.message
}
