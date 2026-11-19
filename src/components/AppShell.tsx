import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { ConnectKitButton } from 'connectkit'
import { useAccount, useSwitchChain } from 'wagmi'
import {
  BarChart3,
  CalendarClock,
  FileText,
  Landmark,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  Users,
  Wallet,
  X,
  Banknote,
  type LucideIcon,
} from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useAuth, canManagePayroll } from '@/lib/auth'
import { CHAIN_ID } from '@/lib/chain'
import { useSettings } from '@/lib/settings'
import { usePayrollSync, useUsdcBalance } from '@/hooks/useChain'
import { Badge, Button } from './ui'
import { backendMode } from '@/lib/supabase'
import { cn, shortAddress } from '@/lib/utils'
import type { Role } from '@/lib/types'

interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

const NAV: Record<Role, NavItem[]> = {
  company_admin: [
    { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/employees', label: 'Employees', icon: Users },
    { to: '/app/payroll', label: 'Payroll', icon: Banknote },
    { to: '/app/budget', label: 'Budget & payments', icon: Landmark },
    { to: '/app/schedules', label: 'Schedules', icon: CalendarClock },
    { to: '/app/history', label: 'Payment history', icon: FileText },
    { to: '/app/reports', label: 'Reports', icon: BarChart3 },
    { to: '/app/settings', label: 'Settings', icon: Settings },
  ],
  payroll_manager: [
    { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/app/employees', label: 'Employees', icon: Users },
    { to: '/app/payroll', label: 'Payroll', icon: Banknote },
    { to: '/app/budget', label: 'Budget & payments', icon: Landmark },
    { to: '/app/schedules', label: 'Schedules', icon: CalendarClock },
    { to: '/app/history', label: 'Payment history', icon: FileText },
    { to: '/app/reports', label: 'Reports', icon: BarChart3 },
  ],
  employee: [{ to: '/app/me', label: 'My salary', icon: Wallet }],
  platform_admin: [{ to: '/app/admin', label: 'Platform admin', icon: ShieldCheck }],
}

export function Logo({ dark }: { dark?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-electric-500 font-display text-lg font-bold text-white">S</span>
      <span className={cn('font-display text-xl font-semibold tracking-tight', dark ? 'text-white' : 'text-navy-900')}>
        Salary<span className="text-electric-500">X</span>
      </span>
    </span>
  )
}

function WalletChip() {
  const { address, chainId, isConnected } = useAccount()
  const { switchChain, isPending } = useSwitchChain()
  const { data: balance } = useUsdcBalance(address)
  return (
    <ConnectKitButton.Custom>
      {({ show, isConnected: connected }) => (
        <div className="flex items-center gap-2">
          {isConnected && chainId !== CHAIN_ID && (
            <Button size="sm" variant="danger" loading={isPending} onClick={() => switchChain({ chainId: CHAIN_ID })}>
              Switch to Arc Testnet
            </Button>
          )}
          <button
            onClick={show}
            className="flex h-10 items-center gap-2 rounded-xl border border-navy-200 bg-white px-3 text-sm font-medium text-navy-800 hover:bg-navy-50"
          >
            <Wallet className="h-4 w-4 text-electric-600" />
            {connected && address ? (
              <>
                <span className="font-mono text-xs">{shortAddress(address)}</span>
                {balance !== undefined && (
                  <span className="num hidden items-center gap-1 border-l border-navy-100 pl-2 sm:flex">
                    <TokenUSDC variant="branded" size={14} />
                    {Number(balance).toFixed(2)}
                  </span>
                )}
              </>
            ) : (
              'Connect wallet'
            )}
          </button>
        </div>
      )}
    </ConnectKitButton.Custom>
  )
}

function NavList({ items, onNavigate }: { items: NavItem[]; onNavigate?: () => void }) {
  return (
    <nav className="space-y-1">
      {items.map((n) => (
        <NavLink
          key={n.to}
          to={n.to}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
              isActive ? 'bg-electric-500 text-white shadow-sm' : 'text-navy-200 hover:bg-white/10 hover:text-white',
            )
          }
        >
          <n.icon className="h-[18px] w-[18px]" />
          {n.label}
        </NavLink>
      ))}
    </nav>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, company, role, logout } = useAuth()
  return (
    <div className="flex h-full flex-col bg-navy-900 p-4">
      <div className="px-2 pb-6 pt-2">
        <Logo dark />
      </div>
      {company && (
        <div className="mb-4 rounded-xl bg-white/5 px-3 py-2.5">
          <p className="text-xs text-navy-300">Company</p>
          <p className="truncate text-sm font-medium text-white">{company.name}</p>
        </div>
      )}
      <NavList items={NAV[role ?? 'employee']} onNavigate={onNavigate} />
      <div className="mt-auto border-t border-white/10 pt-4">
        <p className="truncate px-2 text-sm font-medium text-white">{user?.fullName}</p>
        <p className="truncate px-2 text-xs text-navy-300">{user?.email}</p>
        <button onClick={logout} className="mt-3 flex h-10 w-full items-center gap-2 rounded-xl px-3 text-sm text-navy-200 hover:bg-white/10">
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </div>
  )
}

export function AppShell(): ReactNode {
  const [open, setOpen] = useState(false)
  const { role, company } = useAuth()
  const { demoMode } = useSettings()
  const loc = useLocation()
  usePayrollSync(company?.id, canManagePayroll(role))
  return (
    <div className="min-h-dvh bg-navy-50/60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-navy-950/50" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72">
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
          <button onClick={() => setOpen(false)} aria-label="Close menu" className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-xl bg-white">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-navy-100 bg-white/90 px-4 backdrop-blur sm:px-8">
          <div className="flex items-center gap-3">
            <button onClick={() => setOpen(true)} aria-label="Open menu" className="flex h-10 w-10 items-center justify-center rounded-xl border border-navy-200 lg:hidden">
              <Menu className="h-5 w-5" />
            </button>
            <Badge tone="info">Arc Testnet</Badge>
            {demoMode && <Badge tone="demo">DEMO MODE</Badge>}
          </div>
          <WalletChip />
        </header>
        <main key={loc.pathname} className="mx-auto max-w-7xl px-4 py-8 sm:px-8">
          <Outlet />
        </main>
        <p className="px-8 pb-8 text-center text-xs text-navy-300">
          {backendMode === 'supabase' ? 'Salaries settle in USDC on Arc Testnet.' : 'Demo sign-in stored in this browser only.'} Testnet funds have no value.
        </p>
      </div>
    </div>
  )
}
