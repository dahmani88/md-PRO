import { useState } from 'react'
import { useAuthStore } from '../../store/auth.store'
import CompanySettings from './CompanySettings'
import NetworkSettings from './NetworkSettings'
import UsersSettings from './UsersSettings'
import BackupSettings from './BackupSettings'
import LicenseSettings from './LicenseSettings'
import AuditSettings from './AuditSettings'

const SECTIONS = [
  { id: 'company',  label: 'Entreprise',       icon: '🏢' },
  { id: 'network',  label: 'Réseau',            icon: '🌐' },
  { id: 'users',    label: 'Utilisateurs',      icon: '👥' },
  { id: 'backup',   label: 'Sauvegarde',        icon: '💾' },
  { id: 'licence',  label: 'Licence',           icon: '🔑' },
  { id: 'audit',    label: 'Audit',             icon: '📋' },
] as const

type SectionId = typeof SECTIONS[number]['id']

export default function ParamsPage() {
  const [section, setSection] = useState<SectionId>('company')
  const { user } = useAuthStore()
  const isAdmin = user?.role === 'admin'

  return (
    <div className="h-full flex">
      {/* Sidebar */}
      <div className="w-52 bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 p-3 shrink-0">
        {SECTIONS.filter(s => s.id !== 'audit' || isAdmin).map(s => (
          <button key={s.id} onClick={() => setSection(s.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium mb-1 transition-all
              ${section === s.id
                ? 'bg-primary text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'}`}>
            <span>{s.icon}</span>
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {section === 'company'  && <CompanySettings />}
        {section === 'network'  && <NetworkSettings />}
        {section === 'users'    && <UsersSettings isAdmin={isAdmin} />}
        {section === 'backup'   && <BackupSettings />}
        {section === 'licence'  && <LicenseSettings />}
        {section === 'audit'    && isAdmin && <AuditSettings />}
      </div>
    </div>
  )
}
