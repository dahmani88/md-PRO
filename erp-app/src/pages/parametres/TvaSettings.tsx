import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { toast } from '../../components/ui/Toast'

interface TvaRate {
  id: number
  rate: number
  label: string
  is_active: boolean
}

export default function TvaSettings() {
  const [rates, setRates] = useState<TvaRate[]>([])
  const [loading, setLoading] = useState(true)
  const [newRate, setNewRate] = useState('')
  const [newLabel, setNewLabel] = useState('')
  const [saving, setSaving] = useState(false)

  function load() {
    setLoading(true)
    ;(api as any).getTvaRates()
      .then((r: TvaRate[]) => setRates(r ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    const rate = parseFloat(newRate)
    if (isNaN(rate) || rate < 0 || rate > 100) {
      toast('Taux invalide (0–100)', 'error')
      return
    }
    setSaving(true)
    try {
      await (api as any).createTvaRate({ rate, label: newLabel || `TVA ${rate}%` })
      toast(`Taux ${rate}% ajouté`)
      setNewRate('')
      setNewLabel('')
      load()
    } catch (e: any) {
      toast(e.message, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-md space-y-6">
      <h2 className="text-lg font-semibold">Taux de TVA</h2>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-700/50">
            <tr>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Taux</th>
              <th className="px-4 py-3 text-left font-medium text-gray-600 dark:text-gray-300">Libellé</th>
              <th className="px-4 py-3 text-center font-medium text-gray-600 dark:text-gray-300">Statut</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
            {loading && [...Array(5)].map((_, i) => (
              <tr key={i} className="animate-pulse">
                <td className="px-4 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-12" /></td>
                <td className="px-4 py-3"><div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-24" /></td>
                <td className="px-4 py-3"><div className="h-5 bg-gray-200 dark:bg-gray-700 rounded-full w-16 mx-auto" /></td>
              </tr>
            ))}
            {!loading && rates.map(r => (
              <tr key={r.id}>
                <td className="px-4 py-3 font-bold text-primary">{r.rate}%</td>
                <td className="px-4 py-3 text-gray-700 dark:text-gray-200">{r.label}</td>
                <td className="px-4 py-3 text-center">
                  <span className={r.is_active ? 'badge-green' : 'badge-gray'}>
                    {r.is_active ? '✓ Actif' : '✗ Inactif'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Formulaire ajout */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold mb-3 text-gray-700 dark:text-gray-300">Ajouter un taux</h3>
        <form onSubmit={handleAdd} className="flex items-end gap-3">
          <div className="w-28">
            <label className="block text-xs text-gray-500 mb-1">Taux (%)</label>
            <input
              value={newRate}
              onChange={e => setNewRate(e.target.value)}
              className="input"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="ex: 7"
              required
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-gray-500 mb-1">Libellé (optionnel)</label>
            <input
              value={newLabel}
              onChange={e => setNewLabel(e.target.value)}
              className="input"
              placeholder="ex: TVA 7%"
            />
          </div>
          <button type="submit" disabled={saving} className="btn-primary shrink-0">
            {saving ? '...' : '+ Ajouter'}
          </button>
        </form>
      </div>

      <p className="text-xs text-gray-400">
        Taux conformes au Code Général des Impôts marocain (CGI) — Art. 98 à 100.
      </p>
    </div>
  )
}
