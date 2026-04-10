import { useEffect, useState } from 'react'
import { useAppStore } from './store/app.store'
import { useAuthStore } from './store/auth.store'
import { api } from './lib/api'
import type { DeviceConfig, LicenseInfo } from './types'
import ActivationPage from './pages/ActivationPage'
import SetupWizard    from './pages/SetupWizard'
import LoginPage      from './pages/LoginPage'
import MainLayout     from './pages/MainLayout'
import ToastContainer from './components/ui/Toast'
import ErrorBoundary  from './components/ErrorBoundary'

type AppState = 'loading' | 'activation' | 'setup' | 'login' | 'app'

export default function App() {
  const [state, setState] = useState<AppState>('loading')
  const { theme, setConfig, setLicense } = useAppStore()
  const { isAuthenticated } = useAuthStore()

  useEffect(() => {
    if (!isAuthenticated && state === 'app') {
      setState('login')
    }
  }, [isAuthenticated])

  useEffect(() => {
    // تطبيق الثيم
    document.documentElement.classList.toggle('dark', theme === 'dark')
  }, [theme])

  useEffect(() => {
    async function init() {
      try {
        const license = await api.getLicense().catch(() => null) as LicenseInfo | null
        if (!license || license.isExpired) {
          setState('activation')
          return
        }
        setLicense(license)

        const config = await api.getConfig().catch(() => null) as DeviceConfig | null
        if (!config || !config.setup_done) {
          setState('setup')
          return
        }
        setConfig(config)

        setState(isAuthenticated ? 'app' : 'login')
      } catch {
        setState('activation')
      }
    }
    init()

    // تحقق من الترخيص كل ساعة
    const interval = setInterval(async () => {
      const license = await api.getLicense().catch(() => null) as LicenseInfo | null
      if (license) setLicense(license)
      if (license?.isExpired) setState('activation')
    }, 60 * 60 * 1000)

    return () => clearInterval(interval)
  }, [])

  if (state === 'loading') {
    return (
      <div className="h-screen flex items-center justify-center bg-primary">
        <div className="text-white text-center">
          <div className="text-3xl font-bold mb-2">ERP Pro</div>
          <div className="text-primary-100 text-sm">Chargement...</div>
        </div>
      </div>
    )
  }

  if (state === 'activation') return <ErrorBoundary><ActivationPage onActivated={() => setState('setup')} /><ToastContainer /></ErrorBoundary>
  if (state === 'setup')      return <ErrorBoundary><SetupWizard    onComplete={() => setState('login')} /><ToastContainer /></ErrorBoundary>
  if (state === 'login')      return <ErrorBoundary><LoginPage      onLogin={() => setState('app')} /><ToastContainer /></ErrorBoundary>
  return <ErrorBoundary><MainLayout /><ToastContainer /></ErrorBoundary>
}
