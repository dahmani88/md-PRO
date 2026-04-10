import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { User } from '../types'

const ONLINE_KEY = 'erp_online_users'
const SESSION_START_KEY = 'erp_session_start'

// تسجيل المستخدم كـ "متصل" في localStorage
function markOnline(userId: number) {
  try {
    const online = JSON.parse(localStorage.getItem(ONLINE_KEY) ?? '{}')
    online[userId] = Date.now()
    localStorage.setItem(ONLINE_KEY, JSON.stringify(online))
    localStorage.setItem(SESSION_START_KEY, String(Date.now()))
  } catch {}
}

function markOffline(userId: number) {
  try {
    const online = JSON.parse(localStorage.getItem(ONLINE_KEY) ?? '{}')
    delete online[userId]
    localStorage.setItem(ONLINE_KEY, JSON.stringify(online))
    localStorage.removeItem(SESSION_START_KEY)
  } catch {}
}

export function isUserOnline(userId: number): boolean {
  try {
    const online = JSON.parse(localStorage.getItem(ONLINE_KEY) ?? '{}')
    const ts = online[userId]
    if (!ts) return false
    // نعتبر المستخدم متصلاً إذا كان آخر نشاط منذ أقل من 5 دقائق
    return Date.now() - ts < 5 * 60 * 1000
  } catch { return false }
}

export function getSessionStart(): number | null {
  try {
    const v = localStorage.getItem(SESSION_START_KEY)
    return v ? Number(v) : null
  } catch { return null }
}

// تحديث timestamp النشاط كل دقيقة
if (typeof window !== 'undefined') {
  setInterval(() => {
    try {
      const online = JSON.parse(localStorage.getItem(ONLINE_KEY) ?? '{}')
      const keys = Object.keys(online)
      if (keys.length > 0) {
        keys.forEach(k => { online[k] = Date.now() })
        localStorage.setItem(ONLINE_KEY, JSON.stringify(online))
      }
    } catch {}
  }, 60_000)
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  sessionId?: number
  login:  (user: User & { sessionId?: number }) => void
  logout: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,
      sessionId: undefined,
      login: (user) => {
        markOnline(user.id)
        set({ user, isAuthenticated: true, sessionId: (user as any).sessionId })
      },
      logout: () => {
        const u = get().user
        if (u) markOffline(u.id)
        set({ user: null, isAuthenticated: false, sessionId: undefined })
      },
    }),
    {
      name: 'erp-auth',
      onRehydrateStorage: () => (state) => {
        if (state?.user && state.isAuthenticated) {
          markOnline(state.user.id)
        }
      },
    }
  )
)
