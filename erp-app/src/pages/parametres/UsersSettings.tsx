import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import { useAuthStore, isUserOnline } from '../../store/auth.store'
import UserDetail from './UserDetail'
import type { User } from '../../types'

const ALL_PAGES = [
  { id: 'rapports',     label: 'Rapports',     icon: '📈' },
  { id: 'documents',    label: 'Documents',    icon: '📄' },
  { id: 'paiements',    label: 'Paiements',    icon: '💳' },
  { id: 'parties',      label: 'Parties',      icon: '👥' },
  { id: 'stock',        label: 'Stock',        icon: '📦' },
  { id: 'achats',       label: 'Achats',       icon: '🛒' },
  { id: 'production',   label: 'Production',   icon: '🏭' },
  { id: 'comptabilite', label: 'Comptabilité', icon: '📊' },
  { id: 'parametres',   label: 'Paramètres',   icon: '⚙️' },
]

const ROLE_DEFAULTS: Record<string, string[]> = {
  admin:      ALL_PAGES.map(p => p.id),
  accountant: ['rapports', 'documents', 'paiements', 'parties', 'comptabilite'],
  sales:      ['rapports', 'documents', 'paiements', 'parties', 'stock'],
  warehouse:  ['stock', 'achats', 'production'],
}

interface UserWithPerms extends User {
  permissions?: string[]
  last_login?: string
}

interface Props { isAdmin: boolean }

function PermissionsGrid({ permissions, onChange }: {
  permissions: string[]
  onChange: (p: string[]) => void
}) {
  function toggle(id: string) {
    if (permissions.includes(id)) onChange(permissions.filter(p => p !== id))
    else onChange([...permissions, id])
  }
  return (
    <div className="grid grid-cols-3 gap-2">
      {ALL_PAGES.map(p => (
        <label key={p.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-all text-sm
          ${permissions.includes(p.id)
            ? 'bg-primary/10 border-primary/40 text-primary dark:text-primary-100'
            : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'}`}>
          <input
            type="checkbox"
            checked={permissions.includes(p.id)}
            onChange={() => toggle(p.id)}
            className="w-3.5 h-3.5 accent-primary"
          />
          <span>{p.icon}</span>
          <span className="font-medium">{p.label}</span>
        </label>
      ))}
    </div>
  )
}

export default function UsersSettings({ isAdmin }: Props) {
  const { user: currentUser } = useAuthStore()
  const [users, setUsers] = useState<UserWithPerms[]>([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editUser, setEditUser] = useState<UserWithPerms | null>(null)
  const [confirmDeactivate, setConfirmDeactivate] = useState<UserWithPerms | null>(null)
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [form, setForm] = useState({
    name: '', email: '', password: '', role: 'sales', permissions: ROLE_DEFAULTS.sales,
  })
  const [saving, setSaving] = useState(false)

  function load() {
    api.getUsers().then((r: any) => setUsers(r ?? []))
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const h = () => load()
    window.addEventListener('app:refresh', h)
    return () => window.removeEventListener('app:refresh', h)
  }, [])

  function openCreate() {
    setEditUser(null)
    setForm({ name: '', email: '', password: '', role: 'sales', permissions: ROLE_DEFAULTS.sales })
    setModalOpen(true)
  }

  function openEdit(u: UserWithPerms) {
    setEditUser(u)
    setForm({
      name: u.name,
      email: u.email,
      password: '',
      role: u.role,
      permissions: u.permissions ?? ROLE_DEFAULTS[u.role] ?? [],
    })
    setModalOpen(true)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      if (editUser) {
        await api.updateUser({
          id: editUser.id,
          name: form.name,
          email: form.email,
          role: form.role,
          is_active: editUser.is_active,
          password: form.password || undefined,
          permissions: form.permissions,
        })
        toast('Utilisateur mis à jour')
      } else {
        await api.createUser({ ...form })
        toast('Utilisateur créé')
      }
      setModalOpen(false)
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  async function handleToggleActive(u: UserWithPerms) {
    try {
      await api.updateUser({
        id: u.id, name: u.name, email: u.email,
        role: u.role, is_active: !u.is_active,
        permissions: u.permissions,
      })
      toast(u.is_active ? 'Utilisateur désactivé' : 'Utilisateur activé', 'warning')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setConfirmDeactivate(null)
    }
  }

  const filtered = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Gestion des utilisateurs</h2>
        {isAdmin && (
          <button onClick={openCreate} className="btn-primary btn-sm">+ Nouvel utilisateur</button>
        )}
      </div>
      <div className="mb-4">
        <input value={search} onChange={e => setSearch(e.target.value)}
          className="input max-w-xs text-sm" placeholder="Rechercher..." />
      </div>

      <div className="space-y-3">
        {filtered.map(u => {
          const isSelf = u.id === currentUser?.id
          const roleColors: Record<string, string> = {
            admin:      'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
            accountant: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
            sales:      'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
            warehouse:  'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
          }
          const roleLabels: Record<string, string> = {
            admin: 'Administrateur', accountant: 'Comptable', sales: 'Commercial', warehouse: 'Magasinier',
          }
          return (
            <div key={u.id}
              onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
              onClick={e => {
                const el = e.currentTarget as any
                if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                if ((e.target as HTMLElement).closest('button')) return
                setSelectedUserId(u.id)
              }}
              className={`card px-5 py-4 cursor-pointer transition-all hover:shadow-md
                ${!u.is_active ? 'opacity-50' : ''}
                ${selectedUserId === u.id ? 'ring-2 ring-primary/40' : ''}`}>
              <div className="flex items-center gap-4">
                <div className="relative shrink-0">
                  <div className="w-11 h-11 rounded-full bg-primary flex items-center justify-center text-white font-bold text-base">
                    {u.name[0]?.toUpperCase()}
                  </div>
                  <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${isUserOnline(u.id) ? 'bg-green-500 animate-pulse' : u.is_active ? 'bg-gray-300' : 'bg-gray-400'}`} title={isUserOnline(u.id) ? 'En ligne' : 'Hors ligne'} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-800 dark:text-gray-100">{u.name}</span>
                    {isSelf && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Vous</span>}
                    {isUserOnline(u.id) && !isSelf && <span className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300 px-1.5 py-0.5 rounded-full font-medium">● En ligne</span>}
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${roleColors[u.role] ?? 'bg-gray-100 text-gray-500'}`}>
                      {roleLabels[u.role] ?? u.role}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{u.email}</div>
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-xs text-gray-400">Dernier accès</div>
                  <div className="text-xs font-medium text-gray-600 dark:text-gray-300 mt-0.5">
                    {u.last_login
                      ? new Date(u.last_login.endsWith('Z') ? u.last_login : u.last_login + 'Z')
                          .toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
                      : <span className="text-gray-300">Jamais connecté</span>}
                  </div>
                </div>
                {isAdmin && (
                  <div className="flex gap-1 shrink-0">
                    <button onClick={e => { e.stopPropagation(); openEdit(u) }} title="Modifier"
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/30 text-blue-400 transition-colors">✏️</button>
                    {!isSelf && (
                      <button onClick={e => { e.stopPropagation(); setConfirmDeactivate(u) }}
                        title={u.is_active ? 'Désactiver' : 'Réactiver'}
                        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors ${u.is_active ? 'hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400' : 'hover:bg-green-50 dark:hover:bg-green-900/30 text-green-500'}`}>
                        {u.is_active ? '🚫' : '✅'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      {/* Modal création/édition */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editUser ? `Modifier — ${editUser.name}` : 'Nouvel utilisateur'}
        size="lg">
        <form onSubmit={handleSave} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Nom complet *</label>
              <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                className="input" required autoFocus />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email *</label>
              <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                className="input" type="email" required />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">
              {editUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe *'}
            </label>
            <input value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              className="input" type="password" required={!editUser} placeholder={editUser ? '••••••••' : ''} />
          </div>

          {/* Raccourcis par rôle */}
          <div>
            <label className="block text-sm font-medium mb-2">Accès rapide par profil</label>
            <div className="flex gap-2 flex-wrap">
              {[
                { role: 'admin',      label: 'Admin',      cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' },
                { role: 'accountant', label: 'Comptable',  cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
                { role: 'sales',      label: 'Commercial', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
                { role: 'warehouse',  label: 'Magasinier', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
              ].map(r => (
                <button key={r.role} type="button"
                  onClick={() => setForm(f => ({ ...f, role: r.role, permissions: ROLE_DEFAULTS[r.role] }))}
                  className={`px-3 py-1 rounded-full text-xs font-medium border transition-all
                    ${form.role === r.role ? r.cls + ' border-transparent' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:border-gray-300'}`}>
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Permissions */}
          <div>
            <label className="block text-sm font-medium mb-2">
              Modules accessibles
              <span className="ml-2 text-xs text-gray-400">({form.permissions.length}/{ALL_PAGES.length})</span>
            </label>
            <PermissionsGrid
              permissions={form.permissions}
              onChange={p => setForm(f => ({ ...f, permissions: p }))}
            />
          </div>

          <div className="flex gap-3 pt-2 border-t border-gray-100 dark:border-gray-700">
            <button type="button" onClick={() => setModalOpen(false)} className="btn-secondary flex-1 justify-center">Annuler</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">
              {saving ? '...' : editUser ? '💾 Sauvegarder' : '✅ Créer'}
            </button>
          </div>
        </form>
      </Modal>

      <Drawer open={selectedUserId !== null} onClose={() => setSelectedUserId(null)} title="Fiche utilisateur">
        {selectedUserId !== null && (
          <UserDetail userId={selectedUserId} isOnline={selectedUserId === currentUser?.id} onClose={() => setSelectedUserId(null)} />
        )}
      </Drawer>

      {/* Confirmation désactivation */}
      <ConfirmDialog
        open={confirmDeactivate !== null}
        title={confirmDeactivate?.is_active ? 'Désactiver cet utilisateur ?' : 'Réactiver cet utilisateur ?'}
        message={confirmDeactivate?.is_active
          ? `${confirmDeactivate?.name} ne pourra plus se connecter.`
          : `${confirmDeactivate?.name} pourra à nouveau se connecter.`}
        confirmLabel={confirmDeactivate?.is_active ? 'Désactiver' : 'Réactiver'}
        danger={confirmDeactivate?.is_active}
        onConfirm={() => confirmDeactivate && handleToggleActive(confirmDeactivate)}
        onCancel={() => setConfirmDeactivate(null)}
      />
    </div>
  )
}
