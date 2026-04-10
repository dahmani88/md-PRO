import { useEffect, useState, useCallback, useRef } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'
import Modal from '../../components/ui/Modal'
import Drawer from '../../components/ui/Drawer'
import PartyForm from '../../components/forms/PartyForm'
import PartyDetail from './PartyDetail'
import ImportButton from '../../components/ImportButton'
import SkeletonRows from '../../components/ui/SkeletonRows'
import ConfirmDialog from '../../components/ui/ConfirmDialog'
import type { Client, Supplier } from '../../types'

const fmt = (n: number) => new Intl.NumberFormat('fr-MA', { minimumFractionDigits: 2 }).format(n ?? 0)
const LIMIT = 50

interface Props { type: 'client' | 'supplier' }

export default function PartiesList({ type }: Props) {
  const [rows, setRows]         = useState<(Client | Supplier)[]>([])
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)
  const [page, setPage]         = useState(1)
  const [total, setTotal]       = useState(0)
  const [modalOpen, setModalOpen]   = useState(false)
  const [editing, setEditing]       = useState<Client | Supplier | null>(null)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [deleteId, setDeleteId]     = useState<number | null>(null)
  const searchRef = useRef<ReturnType<typeof setTimeout>>()

  const label   = type === 'client' ? 'Client' : 'Fournisseur'
  const labelPl = type === 'client' ? 'Clients' : 'Fournisseurs'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const fn = type === 'client' ? api.getClients : api.getSuppliers
      const result = await fn({ search, page, limit: LIMIT }) as any
      setRows(result.rows ?? [])
      setTotal(result.total ?? 0)
    } finally {
      setLoading(false)
    }
  }, [type, search, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, type])

  // Écouter le bouton refresh global
  useEffect(() => {
    const handler = () => load()
    window.addEventListener('app:refresh', handler)
    return () => window.removeEventListener('app:refresh', handler)
  }, [load])

  function handleSearch(v: string) {
    clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => setSearch(v), 300)
  }

  async function handleDelete(id: number) {
    try {
      const fn = type === 'client' ? api.deleteClient : api.deleteSupplier
      await fn(id)
      toast(label + ' supprime')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setDeleteId(null)
    }
  }

  const totalDebt   = rows.reduce((s, r) => s + ((r as any).balance ?? 0), 0)
  const withDebt    = rows.filter(r => ((r as any).balance ?? 0) > 0).length
  const withoutDebt = rows.filter(r => ((r as any).balance ?? 0) <= 0).length
  const avgDebt     = withDebt > 0 ? totalDebt / withDebt : 0

  const kpis = type === 'client' ? [
    { label: labelPl,            value: String(total),           sub: withDebt + ' debiteurs',       color: 'text-primary',    bg: 'bg-primary/5',                      icon: '👥' },
    { label: 'Creances totales', value: fmt(totalDebt) + ' MAD', sub: 'Solde a encaisser',           color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/10', icon: '💰', alert: totalDebt > 0 },
    { label: 'Debiteurs',        value: String(withDebt),        sub: withoutDebt + ' soldes',       color: withDebt > 0 ? 'text-red-500' : 'text-green-600', bg: 'bg-red-50 dark:bg-red-900/10', icon: '⚠️' },
    { label: 'Solde moyen',      value: fmt(avgDebt) + ' MAD',   sub: 'Par client debiteur',         color: 'text-gray-600',   bg: 'bg-gray-50 dark:bg-gray-700/30',    icon: '📊' },
  ] : [
    { label: labelPl,              value: String(total),           sub: withDebt + ' crediteurs',      color: 'text-primary',    bg: 'bg-primary/5',                      icon: '🏭' },
    { label: 'Dettes totales',     value: fmt(totalDebt) + ' MAD', sub: 'Solde a regler',             color: 'text-red-500',    bg: 'bg-red-50 dark:bg-red-900/10',      icon: '💸', alert: totalDebt > 0 },
    { label: 'Crediteurs',         value: String(withDebt),        sub: withoutDebt + ' soldes',      color: withDebt > 0 ? 'text-red-500' : 'text-green-600', bg: 'bg-orange-50 dark:bg-orange-900/10', icon: '⚠️' },
    { label: 'Solde moyen',        value: fmt(avgDebt) + ' MAD',   sub: 'Par fournisseur crediteur',  color: 'text-gray-600',   bg: 'bg-gray-50 dark:bg-gray-700/30',    icon: '📊' },
  ]

  return (
    <div className="h-full flex flex-col gap-3">
      <div className="flex items-center justify-between shrink-0">
        <button className="btn-primary px-5 py-2.5 text-sm font-semibold shadow-sm"
          onClick={() => { setEditing(null); setModalOpen(true) }}>
          + Nouveau {label}
        </button>
        <div className="flex gap-2">
          <ImportButton type={type === 'client' ? 'clients' : 'suppliers'} onImported={load} />
          <button onClick={async () => {
            try { await api.excelExportParties(type); toast('Fichier Excel enregistre') }
            catch (e: any) { toast(e.message, 'error') }
          }} className="btn-secondary btn-sm">Exporter</button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 shrink-0">
        {kpis.map(c => (
          <div key={c.label} className={`card p-4 ${c.bg} ${(c as any).alert ? 'border-orange-200 dark:border-orange-800' : ''}`}>
            <div className="text-xs text-gray-400 mb-0.5">{c.label}</div>
            <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
            <div className="text-xs text-gray-400 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="shrink-0">
        <input onChange={e => handleSearch(e.target.value)}
          className="input max-w-sm text-sm"
          placeholder={'Rechercher par nom, ICE, telephone...'} />
      </div>

      <div className="card flex-1 overflow-auto">
        <table className="w-full text-sm border-collapse" style={{ tableLayout: 'fixed' }}>
          <colgroup>
            <col style={{ width: '180px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '120px' }} />
            <col style={{ width: '160px' }} />
            <col style={{ width: '147px' }} />
            <col style={{ width: '72px' }} />
          </colgroup>
          <thead className="bg-gray-50 dark:bg-gray-700/50 sticky top-0 z-10 [&_th]:border [&_th]:border-gray-200 dark:[&_th]:border-gray-600">
            <tr>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Nom</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">ICE</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Telephone</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Email</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300">Solde</th>
              <th className="px-4 py-3 text-center align-middle font-medium text-gray-600 dark:text-gray-300"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700 [&_td]:border [&_td]:border-gray-100 dark:[&_td]:border-gray-700">
            {loading && <SkeletonRows cols={6} />}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16">
                <div className="text-4xl mb-3">👥</div>
                <div className="text-gray-500 font-medium">
                  {search ? 'Aucun resultat pour "' + search + '"' : 'Aucun ' + label.toLowerCase()}
                </div>
                {!search && (
                  <button onClick={() => { setEditing(null); setModalOpen(true) }} className="btn-primary mt-3 text-sm">
                    + Creer le premier
                  </button>
                )}
              </td></tr>
            )}
            {rows.map(row => {
              const bal = (row as any).balance ?? 0
              const isSelected = selectedId === row.id
              return (
                <tr key={row.id} onMouseDown={e => { (e.currentTarget as any)._mdX = e.clientX; (e.currentTarget as any)._mdY = e.clientY }}
                  onClick={e => {
                    const el = e.currentTarget as any
                    if (Math.abs(e.clientX-(el._mdX??e.clientX))>5||Math.abs(e.clientY-(el._mdY??e.clientY))>5) return
                    if ((e.target as HTMLElement).closest('button')) return
                    setSelectedId(row.id)
                  }}
                  className={'cursor-pointer transition-colors ' + (isSelected
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-700/30')}>
                  <td className="px-4 py-3 text-center align-middle">
                    <div className="font-medium text-gray-800 dark:text-gray-100">{row.name}</div>
                    {row.notes && <div className="text-xs text-gray-400 truncate max-w-[180px]">{row.notes}</div>}
                  </td>
                  <td className="px-4 py-3 text-center align-middle text-gray-500 font-mono text-xs">{row.ice ?? '—'}</td>
                  <td className="px-4 py-3 text-center align-middle text-gray-600 dark:text-gray-300">{row.phone ?? '—'}</td>
                  <td className="px-4 py-3 text-center align-middle text-gray-600 dark:text-gray-300 text-xs">{row.email ?? '—'}</td>
                  <td className="px-4 py-3 text-center align-middle">
                    <span className={'font-semibold ' + (bal > 0 ? (type === 'client' ? 'text-orange-500' : 'text-red-500') : 'text-gray-400')}>
                      {fmt(bal)} MAD
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center align-middle" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1 justify-end">
                      <button onClick={() => { setEditing(row); setModalOpen(true) }}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 transition-colors text-sm">
                        ✏️
                      </button>
                      <button onClick={() => setDeleteId(row.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 dark:hover:bg-red-900/30 text-red-400 transition-colors text-sm">
                        🗑️
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {total > LIMIT && (
        <div className="flex items-center justify-between shrink-0 text-xs text-gray-500">
          <span>{total} {labelPl.toLowerCase()}</span>
          <div className="flex gap-1">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} className="btn-secondary btn-sm disabled:opacity-40">←</button>
            <span className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
              {page} / {Math.ceil(total / LIMIT)}
            </span>
            <button disabled={page >= Math.ceil(total / LIMIT)} onClick={() => setPage(p => p + 1)} className="btn-secondary btn-sm disabled:opacity-40">→</button>
          </div>
        </div>
      )}

      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editing ? 'Modifier ' + label : 'Nouveau ' + label}>
        <PartyForm type={type} initial={editing ?? undefined}
          onSaved={() => { setModalOpen(false); load() }}
          onCancel={() => setModalOpen(false)} />
      </Modal>

      <Drawer open={selectedId !== null} onClose={() => setSelectedId(null)}
        title={'Fiche ' + label} width="w-[720px]">
        {selectedId !== null && (
          <PartyDetail id={selectedId} type={type}
            onClose={() => setSelectedId(null)} />
        )}
      </Drawer>

      <ConfirmDialog open={deleteId !== null}
        title={'Supprimer ce ' + label.toLowerCase()}
        message="Cette action est irreversible. Le contact sera archive."
        confirmLabel="Supprimer" danger
        onConfirm={() => deleteId && handleDelete(deleteId)}
        onCancel={() => setDeleteId(null)} />
    </div>
  )
}
