import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from '@/lib/auth'
import type { Role } from '@/lib/types'
import { AppShell } from '@/components/AppShell'
import Landing from '@/pages/Landing'
import Auth from '@/pages/Auth'
import Dashboard from '@/pages/Dashboard'
import Employees from '@/pages/Employees'
import EmployeeForm from '@/pages/EmployeeForm'
import Payroll from '@/pages/Payroll'
import Budget from '@/pages/Budget'
import Schedules from '@/pages/Schedules'
import History from '@/pages/History'
import TransactionDetail from '@/pages/TransactionDetail'
import EmployeePortal from '@/pages/EmployeePortal'
import Payslip from '@/pages/Payslip'
import Reports from '@/pages/Reports'
import Settings from '@/pages/Settings'
import PlatformAdmin from '@/pages/PlatformAdmin'

const home = (role?: Role) =>
  role === 'employee' ? '/app/me' : role === 'platform_admin' ? '/app/admin' : '/app/dashboard'

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-white" role="status" aria-label="Loading">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-navy-100 border-t-electric-500" />
    </div>
  )
}

function Protected({ roles, children }: { roles?: Role[]; children: ReactNode }) {
  const { user, role, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (roles && role && !roles.includes(role)) return <Navigate to={home(role)} replace />
  return <>{children}</>
}

function AppIndex() {
  const { role } = useAuth()
  return <Navigate to={home(role)} replace />
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, role, loading } = useAuth()
  if (loading) return <Splash />
  if (user) return <Navigate to={home(role)} replace />
  return <>{children}</>
}

const STAFF: Role[] = ['company_admin', 'payroll_manager']

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<GuestOnly><Auth mode="login" /></GuestOnly>} />
          <Route path="/register" element={<GuestOnly><Auth mode="register" /></GuestOnly>} />
          <Route path="/app" element={<Protected><AppShell /></Protected>}>
            <Route index element={<AppIndex />} />
            <Route path="dashboard" element={<Protected roles={STAFF}><Dashboard /></Protected>} />
            <Route path="employees" element={<Protected roles={STAFF}><Employees /></Protected>} />
            <Route path="employees/new" element={<Protected roles={STAFF}><EmployeeForm /></Protected>} />
            <Route path="employees/:id" element={<Protected roles={STAFF}><EmployeeForm /></Protected>} />
            <Route path="payroll" element={<Protected roles={STAFF}><Payroll /></Protected>} />
            <Route path="budget" element={<Protected roles={STAFF}><Budget /></Protected>} />
            <Route path="schedules" element={<Protected roles={STAFF}><Schedules /></Protected>} />
            <Route path="history" element={<Protected roles={STAFF}><History /></Protected>} />
            <Route path="history/:id" element={<Protected roles={STAFF}><TransactionDetail /></Protected>} />
            <Route path="reports" element={<Protected roles={STAFF}><Reports /></Protected>} />
            <Route path="settings" element={<Protected roles={['company_admin']}><Settings /></Protected>} />
            <Route path="me" element={<Protected roles={['employee']}><EmployeePortal /></Protected>} />
            <Route path="me/payslip/:itemId" element={<Protected roles={['employee']}><Payslip /></Protected>} />
            <Route path="admin" element={<Protected roles={['platform_admin']}><PlatformAdmin /></Protected>} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
