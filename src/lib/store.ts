import { useSyncExternalStore } from 'react'
import { backendMode } from './supabase'
import type {
  AuditLog,
  Company,
  CompanyMember,
  Employee,
  PaymentTransaction,
  Payroll,
  PayrollItem,
  PayrollSchedule,
  Profile,
} from './types'

/**
 * Repository with a synchronous read cache. Each table mirrors a Supabase table.
 * - Local mode: rows persist in this browser (demo).
 * - Supabase mode: rows live in memory only, are loaded from Postgres (filtered by row level
 *   security), and every write is pushed to Postgres through the remote handler.
 */
interface TableMap {
  profiles: Profile
  companies: Company
  members: CompanyMember
  employees: Employee
  payrolls: Payroll
  payrollItems: PayrollItem
  transactions: PaymentTransaction
  schedules: PayrollSchedule
  auditLogs: AuditLog
}
export type TableName = keyof TableMap

export interface RemoteHandler {
  insert: (name: TableName, row: object) => void
  update: (name: TableName, id: string, patch: object) => void
  remove: (name: TableName, id: string) => void
}

const REMOTE = backendMode === 'supabase'
const PREFIX = 'salaryx:v1:'
const cache = new Map<string, unknown[]>()
const listeners = new Set<() => void>()
let remote: RemoteHandler | undefined

export function setRemote(handler: RemoteHandler) {
  remote = handler
}

function load(name: string): unknown[] {
  const hit = cache.get(name)
  if (hit) return hit
  let rows: unknown[] = []
  if (!REMOTE) {
    try {
      const raw = localStorage.getItem(PREFIX + name)
      rows = raw ? (JSON.parse(raw) as unknown[]) : []
    } catch {
      rows = []
    }
  }
  cache.set(name, rows)
  return rows
}

function save(name: string, rows: unknown[]) {
  cache.set(name, rows)
  if (!REMOTE) {
    try {
      localStorage.setItem(PREFIX + name, JSON.stringify(rows))
    } catch {
      // storage full or unavailable: keep the in-memory copy for this session
    }
  }
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined' && !REMOTE) {
  window.addEventListener('storage', (e) => {
    if (e.key?.startsWith(PREFIX)) {
      cache.delete(e.key.slice(PREFIX.length))
      listeners.forEach((l) => l())
    }
  })
}

const subscribe = (cb: () => void) => {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** Replace a table's rows with a fresh copy from the server. */
export function hydrate(name: TableName, rows: unknown[]) {
  cache.set(name, rows)
  listeners.forEach((l) => l())
}

/** Drop every cached table (used on sign-out so data never leaks between accounts). */
export function clearAll() {
  cache.clear()
  listeners.forEach((l) => l())
}

export function table<N extends TableName>(name: N) {
  type Row = TableMap[N]
  const rows = () => load(name) as Row[]
  return {
    all: (): Row[] => rows(),
    get: (id: string): Row | undefined => rows().find((r) => (r as { id: string }).id === id),
    where: (fn: (r: Row) => boolean): Row[] => rows().filter(fn),
    insert: (row: Row): Row => {
      save(name, [...rows(), row])
      remote?.insert(name, row)
      return row
    },
    update: (id: string, patch: Partial<Row>, opts?: { skipRemote?: boolean }): Row | undefined => {
      let updated: Row | undefined
      save(
        name,
        rows().map((r) => {
          if ((r as { id: string }).id !== id) return r
          updated = { ...r, ...patch }
          return updated
        }),
      )
      if (!opts?.skipRemote) remote?.update(name, id, patch)
      return updated
    },
    remove: (id: string) => {
      save(name, rows().filter((r) => (r as { id: string }).id !== id))
      remote?.remove(name, id)
    },
    removeWhere: (fn: (r: Row) => boolean) => {
      const gone = rows().filter(fn)
      save(name, rows().filter((r) => !fn(r)))
      gone.forEach((r) => remote?.remove(name, (r as { id: string }).id))
    },
  }
}

export const db = {
  profiles: table('profiles'),
  companies: table('companies'),
  members: table('members'),
  employees: table('employees'),
  payrolls: table('payrolls'),
  payrollItems: table('payrollItems'),
  transactions: table('transactions'),
  schedules: table('schedules'),
  auditLogs: table('auditLogs'),
}

export function useTable<N extends TableName>(name: N): TableMap[N][] {
  return useSyncExternalStore(subscribe, () => load(name) as TableMap[N][])
}

export function newId(): string {
  return crypto.randomUUID()
}

/** Raw key/value helpers for small singletons (local session, settings, rates). Not used for business data. */
export function getJson<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return undefined
  }
}
export function setJson(key: string, value: unknown) {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
  listeners.forEach((l) => l())
}
export function removeJson(key: string) {
  localStorage.removeItem(PREFIX + key)
  listeners.forEach((l) => l())
}

/** Subscribe to a singleton key. The snapshot is the raw string so it stays referentially stable. */
export function useJsonRaw(key: string): string | null {
  return useSyncExternalStore(subscribe, () => localStorage.getItem(PREFIX + key))
}
