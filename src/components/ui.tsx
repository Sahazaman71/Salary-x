import { forwardRef, useEffect, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'electric'
type Size = 'sm' | 'md' | 'lg'

const variants: Record<Variant, string> = {
  primary: 'bg-navy-900 text-white hover:bg-navy-800 shadow-sm',
  electric: 'bg-electric-500 text-white hover:bg-electric-600 shadow-sm',
  secondary: 'bg-white text-navy-900 border border-navy-200 hover:bg-navy-50',
  ghost: 'text-navy-700 hover:bg-navy-50',
  danger: 'bg-red-600 text-white hover:bg-red-700',
}
const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-11 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: LucideIcon
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon: Icon, className, children, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-electric-500',
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      {children}
    </button>
  )
})

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('rounded-2xl border border-navy-100 bg-white shadow-card', className)}>{children}</div>
}

export function CardHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-navy-100 px-5 py-4">
      <div>
        <h3 className="font-display text-base font-semibold text-navy-900">{title}</h3>
        {subtitle && <p className="mt-0.5 text-sm text-navy-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

const fieldBase =
  'w-full rounded-xl border border-navy-200 bg-white px-3.5 text-sm text-navy-900 placeholder:text-navy-300 focus:border-electric-500 focus:outline-none focus:ring-2 focus:ring-electric-100 disabled:bg-navy-50'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cn(fieldBase, 'h-11', className)} {...rest} />
})

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cn(fieldBase, 'py-2.5', className)} {...rest} />
})

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cn(fieldBase, 'h-11', className)} {...rest}>
      {children}
    </select>
  )
})

export function Field({ label, error, hint, children }: { label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-navy-700">{label}</span>
      {children}
      {hint && !error && <span className="mt-1 block text-xs text-navy-400">{hint}</span>}
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </label>
  )
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'demo'
const tones: Record<Tone, string> = {
  neutral: 'bg-navy-50 text-navy-600 ring-navy-100',
  success: 'bg-emerald-50 text-emerald-700 ring-emerald-100',
  warning: 'bg-amber-50 text-amber-700 ring-amber-100',
  danger: 'bg-red-50 text-red-700 ring-red-100',
  info: 'bg-electric-50 text-electric-700 ring-electric-100',
  demo: 'bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200',
}
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset', tones[tone])}>{children}</span>
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div className={cn('relative overflow-hidden rounded-lg bg-navy-100', className)}>
      <div className="absolute inset-0 -translate-x-full animate-shimmer bg-gradient-to-r from-transparent via-white/60 to-transparent" />
    </div>
  )
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: LucideIcon; title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-electric-50 text-electric-600">
        <Icon className="h-6 w-6" />
      </div>
      <h4 className="font-display text-base font-semibold text-navy-900">{title}</h4>
      <p className="mt-1 max-w-sm text-sm text-navy-400">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-end justify-center bg-navy-950/50 p-0 sm:items-center sm:p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={onClose}>
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            onMouseDown={(e) => e.stopPropagation()}
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            className={cn('max-h-[90dvh] w-full overflow-y-auto rounded-t-3xl bg-white shadow-pop sm:rounded-3xl', wide ? 'sm:max-w-2xl' : 'sm:max-w-md')}
          >
            <div className="flex items-center justify-between border-b border-navy-100 px-5 py-4">
              <h3 className="font-display text-lg font-semibold">{title}</h3>
              <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-lg text-navy-400 hover:bg-navy-50">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="p-5">{children}</div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  children,
  confirmLabel = 'Confirm',
  loading,
  danger,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  children: ReactNode
  confirmLabel?: string
  loading?: boolean
  danger?: boolean
}) {
  return (
    <Dialog open={open} onClose={loading ? () => undefined : onClose} title={title}>
      <div className="space-y-5 text-sm text-navy-600">{children}</div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant={danger ? 'danger' : 'electric'} onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warning' | 'danger' | 'demo'; title?: string; children: ReactNode }) {
  const map = {
    info: 'border-electric-100 bg-electric-50 text-electric-700',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    danger: 'border-red-200 bg-red-50 text-red-800',
    demo: 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-800',
  }
  return (
    <div className={cn('rounded-xl border px-4 py-3 text-sm', map[tone])}>
      {title && <p className="font-semibold">{title}</p>}
      <div className={title ? 'mt-0.5' : ''}>{children}</div>
    </div>
  )
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-navy-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function StatCard({ label, value, sub, icon: Icon }: { label: string; value: ReactNode; sub?: ReactNode; icon: LucideIcon }) {
  return (
    <Card className="p-5">
      <div className="flex items-center justify-between">
        <span className="text-sm text-navy-400">{label}</span>
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-electric-50 text-electric-600">
          <Icon className="h-[18px] w-[18px]" />
        </span>
      </div>
      <div className="num mt-3 font-display text-2xl font-semibold text-navy-900">{value}</div>
      {sub && <div className="mt-1 text-xs text-navy-400">{sub}</div>}
    </Card>
  )
}

export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cn('px-5 py-3 text-left text-xs font-medium uppercase tracking-wider text-navy-400', className)}>{children}</th>
)
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cn('px-5 py-3.5 text-sm text-navy-700', className)}>{children}</td>
)
