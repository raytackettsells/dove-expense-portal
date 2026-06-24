import { useEffect, useState, useMemo } from 'react'
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from 'recharts'
import { supabase } from './supabase'

const MONTHS = [
  'Jan','Feb','Mar','Apr','May','Jun',
  'Jul','Aug','Sep','Oct','Nov','Dec'
]

const PALETTE = [
  '#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981',
  '#3b82f6','#ef4444','#14b8a6','#f97316','#84cc16',
  '#a855f7','#06b6d4',
]

const fmt = (n) => '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fmtK = (n) => n >= 1000 ? '$' + (n/1000).toFixed(1) + 'k' : fmt(n)

function StatCard({ label, value, sub, color }) {
  return (
    <div className="card">
      <p className="text-gray-500 text-sm">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${color ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-gray-600 text-xs mt-1">{sub}</p>}
    </div>
  )
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm">
      {label && <p className="text-gray-400 mb-1">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color ?? p.fill }}>{p.name}: {fmt(p.value)}</p>
      ))}
    </div>
  )
}

export default function Dashboard() {
  const [transactions, setTransactions] = useState([])
  const [facilities, setFacilities] = useState([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [selFacility, setSelFacility] = useState('all')
  const [selYear, setSelYear] = useState('all')
  const [selMonth, setSelMonth] = useState('all')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const [{ data: txData }, { data: facData }] = await Promise.all([
        supabase.from('transactions').select('*').order('transaction_date', { ascending: false }),
        supabase.from('facilities').select('*'),
      ])
      setTransactions(txData ?? [])
      setFacilities(facData ?? [])
      setLoading(false)
    }
    load()
  }, [])

  // Available years
  const years = useMemo(() => {
    const ys = [...new Set(transactions.map(t => t.statement_year))].filter(Boolean).sort()
    return ys
  }, [transactions])

  // Filtered transactions
  const filtered = useMemo(() => {
    return transactions.filter(t => {
      if (selFacility !== 'all') {
        const fac = facilities.find(f => f.id === t.facility_id)
        if (!fac || fac.name !== selFacility) return false
      }
      if (selYear !== 'all' && t.statement_year !== parseInt(selYear)) return false
      if (selMonth !== 'all' && t.statement_month !== parseInt(selMonth)) return false
      return true
    })
  }, [transactions, facilities, selFacility, selYear, selMonth])

  // Aggregates
  const totalSpend = useMemo(() => filtered.reduce((s, t) => s + Number(t.amount), 0), [filtered])
  const txCount = filtered.length

  // By category
  const byCategory = useMemo(() => {
    const map = {}
    filtered.forEach(t => {
      const cat = t.category || 'Uncategorized'
      map[cat] = (map[cat] ?? 0) + Number(t.amount)
    })
    return Object.entries(map)
      .map(([name, value]) => ({ name, value: parseFloat(value.toFixed(2)) }))
      .sort((a, b) => b.value - a.value)
  }, [filtered])

  // By cardholder
  const byCardholder = useMemo(() => {
    const map = {}
    filtered.forEach(t => {
      const name = t.cardholder_name || 'Unknown'
      map[name] = (map[name] ?? 0) + Number(t.amount)
    })
    return Object.entries(map)
      .map(([name, total]) => ({ name, total: parseFloat(total.toFixed(2)) }))
      .sort((a, b) => b.total - a.total)
  }, [filtered])

  // Month-over-month trend
  const monthlyTrend = useMemo(() => {
    const map = {}
    transactions.forEach(t => {
      if (selFacility !== 'all') {
        const fac = facilities.find(f => f.id === t.facility_id)
        if (!fac || fac.name !== selFacility) return
      }
      if (!t.statement_year || !t.statement_month) return
      const key = `${t.statement_year}-${String(t.statement_month).padStart(2,'0')}`
      map[key] = (map[key] ?? 0) + Number(t.amount)
    })
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, total]) => {
        const [y, m] = key.split('-')
        return { label: `${MONTHS[parseInt(m)-1]} '${y.slice(2)}`, total: parseFloat(total.toFixed(2)) }
      })
  }, [transactions, facilities, selFacility])

  // Top transactions
  const topTx = useMemo(() => [...filtered].sort((a, b) => b.amount - a.amount).slice(0, 10), [filtered])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500" />
      </div>
    )
  }

  const hasData = filtered.length > 0

  return (
    <div className="space-y-6">
      {/* Header + Filters */}
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Dashboard</h1>
          {!hasData && transactions.length === 0 && (
            <p className="text-gray-500 text-sm mt-1">No data yet — go to <a href="/import" className="text-indigo-400 hover:underline">Import</a> to upload a statement.</p>
          )}
        </div>
        <div className="flex flex-wrap gap-3 ml-auto">
          <select className="input w-32 text-sm py-1.5" value={selFacility} onChange={e => setSelFacility(e.target.value)}>
            <option value="all">All facilities</option>
            {facilities.map(f => <option key={f.id} value={f.name}>{f.name}</option>)}
          </select>
          <select className="input w-28 text-sm py-1.5" value={selYear} onChange={e => setSelYear(e.target.value)}>
            <option value="all">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select className="input w-32 text-sm py-1.5" value={selMonth} onChange={e => setSelMonth(e.target.value)}>
            <option value="all">All months</option>
            {MONTHS.map((m, i) => <option key={m} value={i+1}>{m}</option>)}
          </select>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Spend" value={fmt(totalSpend)} color="text-indigo-400" />
        <StatCard label="Transactions" value={txCount.toLocaleString()} />
        <StatCard
          label="Avg per Transaction"
          value={txCount > 0 ? fmt(totalSpend / txCount) : '—'}
        />
        <StatCard
          label="Top Category"
          value={byCategory[0]?.name ?? '—'}
          sub={byCategory[0] ? fmt(byCategory[0].value) : ''}
        />
      </div>

      {hasData && (
        <>
          {/* Charts row */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Category donut */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-4">Spend by Category</h2>
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={byCategory}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    dataKey="value"
                  >
                    {byCategory.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend
                    formatter={(value) => <span className="text-gray-400 text-xs">{value}</span>}
                    iconSize={10}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Cardholder bars */}
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-4">Spend by Cardholder</h2>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={byCardholder} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmtK} tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fill: '#9ca3af', fontSize: 12 }} width={100} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: '#1f2937' }} />
                  <Bar dataKey="total" name="Total" radius={[0,4,4,0]}>
                    {byCardholder.map((_, i) => (
                      <Cell key={i} fill={PALETTE[i % PALETTE.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Month-over-month trend */}
          {monthlyTrend.length > 1 && (
            <div className="card">
              <h2 className="text-sm font-semibold text-gray-400 mb-4">Month-over-Month Spend</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={monthlyTrend} margin={{ left: 10, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                  <XAxis dataKey="label" tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <YAxis tickFormatter={fmtK} tick={{ fill: '#6b7280', fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#4f46e5', strokeWidth: 1 }} />
                  <Line
                    type="monotone"
                    dataKey="total"
                    name="Total"
                    stroke="#6366f1"
                    strokeWidth={2.5}
                    dot={{ fill: '#6366f1', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Top transactions table */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">Top Transactions</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 border-b border-gray-800">
                    <th className="pb-2 pr-4">Date</th>
                    <th className="pb-2 pr-4">Description</th>
                    <th className="pb-2 pr-4">Cardholder</th>
                    <th className="pb-2 pr-4">Category</th>
                    <th className="pb-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {topTx.map((t, i) => (
                    <tr key={t.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                      <td className="py-2 pr-4 text-gray-500 whitespace-nowrap">{t.transaction_date ?? '—'}</td>
                      <td className="py-2 pr-4 text-gray-300 max-w-[220px] truncate">{t.description}</td>
                      <td className="py-2 pr-4 text-gray-400">{t.cardholder_name || '—'}</td>
                      <td className="py-2 pr-4">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full"
                          style={{
                            background: PALETTE[byCategory.findIndex(c => c.name === t.category) % PALETTE.length] + '33',
                            color: PALETTE[byCategory.findIndex(c => c.name === t.category) % PALETTE.length],
                          }}
                        >
                          {t.category || 'Uncategorized'}
                        </span>
                      </td>
                      <td className="py-2 text-right text-green-400 font-mono font-medium">
                        {fmt(t.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Category breakdown list */}
          <div className="card">
            <h2 className="text-sm font-semibold text-gray-400 mb-4">Category Breakdown</h2>
            <div className="space-y-2">
              {byCategory.map((cat, i) => (
                <div key={cat.name} className="flex items-center gap-3">
                  <div
                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                    style={{ background: PALETTE[i % PALETTE.length] }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-center mb-0.5">
                      <span className="text-gray-300 text-sm truncate">{cat.name}</span>
                      <span className="text-gray-400 text-sm ml-4 flex-shrink-0">{fmt(cat.value)}</span>
                    </div>
                    <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${(cat.value / (byCategory[0]?.value || 1)) * 100}%`,
                          background: PALETTE[i % PALETTE.length],
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-gray-600 text-xs w-10 text-right flex-shrink-0">
                    {totalSpend > 0 ? ((cat.value / totalSpend) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
