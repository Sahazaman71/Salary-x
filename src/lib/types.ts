/** Domain types. These mirror the Supabase tables in supabase/migrations. */

export const CURRENCIES = ['USD', 'EUR', 'GBP', 'BDT', 'INR', 'PHP', 'AUD'] as const
export type Currency = (typeof CURRENCIES)[number]

export type Role = 'company_admin' | 'payroll_manager' | 'employee' | 'platform_admin'
export type MemberRole = 'company_admin' | 'payroll_manager'

export interface Profile {
  id: string
  email: string
  fullName: string
  role: Role
  /** Demo auth only. Supabase mode never stores or sees passwords here. */
  passwordHash?: string
  salt?: string
  companyId?: string
  employeeId?: string
  createdAt: number
}

export interface Company {
  id: string
  name: string
  country: string
  defaultCurrency: Currency
  ownerId: string
  /** bytes32 id used by the SalaryXPayroll contract */
  onchainId: `0x${string}`
  createdAt: number
}

export interface CompanyMember {
  id: string
  companyId: string
  email: string
  role: MemberRole
  profileId?: string
  wallet?: string
  createdAt: number
}

export type WalletStatus = 'none' | 'pending' | 'approved'
export type EmployeeStatus = 'active' | 'inactive' | 'invited'

export interface Employee {
  id: string
  companyId: string
  profileId?: string
  name: string
  email: string
  country: string
  wallet?: string
  walletStatus: WalletStatus
  /** Salary as entered, in `currency`. */
  salaryAmount: string
  currency: Currency
  status: EmployeeStatus
  createdAt: number
}

export type PayrollStatus = 'draft' | 'approved' | 'queued' | 'executed' | 'cancelled' | 'failed'

export interface Payroll {
  id: string
  companyId: string
  title: string
  /** YYYYMM, derived from executeAfter in UTC (matches the contract). */
  period: number
  executeAfter: number
  status: PayrollStatus
  /** Total in USDC, decimal string. */
  totalUsdc: string
  onchainBatchId?: string
  demo: boolean
  scheduleId?: string
  createdBy: string
  createdAt: number
}

export interface PayrollItem {
  id: string
  payrollId: string
  employeeId: string
  wallet: string
  amountUsdc: string
  /** Estimate shown to the employee, never used for settlement. */
  displayAmount: string
  displayCurrency: Currency
}

export type TxKind =
  | 'register_company'
  | 'deposit'
  | 'withdraw'
  | 'set_allowance'
  | 'set_manager'
  | 'set_executor'
  | 'batch_create'
  | 'batch_execute'
  | 'batch_cancel'

export type TxStatus = 'pending' | 'success' | 'failed' | 'demo'

export interface PaymentTransaction {
  id: string
  companyId: string
  payrollId?: string
  kind: TxKind
  hash?: string
  status: TxStatus
  amountUsdc: string
  blockNumber?: string
  /** True once the receipt and the emitted events were checked against what was requested. */
  verified: boolean
  error?: string
  createdBy: string
  createdAt: number
}

export type Frequency = 'daily' | 'weekly' | 'monthly'

export interface PayrollSchedule {
  id: string
  companyId: string
  name: string
  frequency: Frequency
  /** Day of month (1-28) for monthly, weekday (0-6) for weekly, ignored for daily. */
  anchor: number
  active: boolean
  employeeIds: string[]
  createdAt: number
}

export interface AuditLog {
  id: string
  companyId?: string
  actorId: string
  actorEmail: string
  action: string
  entity: string
  detail: string
  createdAt: number
}

export interface RateSnapshot {
  base: 'USD'
  rates: Record<Currency, number>
  fetchedAt: number
  source: 'live' | 'cached' | 'fallback'
}
