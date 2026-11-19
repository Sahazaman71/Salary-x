import { ExternalLink, FlaskConical, ShieldCheck } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { Badge, Notice } from './ui'
import { txUrl } from '@/lib/chain'
import { rateLabel, useRates } from '@/lib/rates'
import { fmtUsdc, shortHash } from '@/lib/utils'
import type { PayrollStatus, TxStatus } from '@/lib/types'

export function TxStatusBadge({ status, verified }: { status: TxStatus; verified?: boolean }) {
  if (status === 'demo') return <Badge tone="demo"><FlaskConical className="h-3 w-3" />DEMO</Badge>
  if (status === 'success') return <Badge tone="success"><ShieldCheck className="h-3 w-3" />{verified ? 'Confirmed' : 'Success'}</Badge>
  if (status === 'failed') return <Badge tone="danger">Failed</Badge>
  return <Badge tone="warning">Pending</Badge>
}

const payrollTone: Record<PayrollStatus, 'neutral' | 'info' | 'warning' | 'success' | 'danger'> = {
  draft: 'neutral',
  approved: 'info',
  queued: 'warning',
  executed: 'success',
  cancelled: 'neutral',
  failed: 'danger',
}
const payrollLabel: Record<PayrollStatus, string> = {
  draft: 'Draft',
  approved: 'Approved',
  queued: 'Queued onchain',
  executed: 'Paid',
  cancelled: 'Cancelled',
  failed: 'Failed',
}
export function PayrollStatusBadge({ status, demo }: { status: PayrollStatus; demo?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Badge tone={payrollTone[status]}>{payrollLabel[status]}</Badge>
      {demo && <Badge tone="demo">DEMO</Badge>}
    </span>
  )
}

export function TxLink({ hash }: { hash?: string }) {
  if (!hash) return <span className="text-navy-300">No hash</span>
  return (
    <a href={txUrl(hash)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono text-xs text-electric-600 hover:underline">
      {shortHash(hash)}
      <ExternalLink className="h-3 w-3" />
    </a>
  )
}

export function UsdcAmount({ value, className }: { value: string | number; className?: string }) {
  return (
    <span className={`num inline-flex items-center gap-1.5 ${className ?? ''}`}>
      <TokenUSDC variant="branded" size={16} />
      {fmtUsdc(value)}
    </span>
  )
}

/** Shown wherever a converted amount appears. */
export function EstimateNotice() {
  const { data } = useRates()
  return (
    <Notice tone="info" title="Currency amounts are estimates">
      Local currency figures are indicative conversions. Salaries settle in USDC on Arc. SalaryX does not pay out to local bank accounts. {rateLabel(data)}.
    </Notice>
  )
}

export function DemoBanner() {
  return (
    <Notice tone="demo" title="Demo mode is on">
      Payments are simulated and marked DEMO. No onchain transaction is sent and nothing is marked as confirmed. Turn it off in Settings to use Arc Testnet.
    </Notice>
  )
}
