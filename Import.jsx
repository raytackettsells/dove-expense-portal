import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from './supabase'

const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
]

// Maps card last-4 to cardholder name (update as needed)
const CARD_MAP = {
  '2127': 'Chad Thomas',
  '4521': 'Meghan',
  '3344': 'Ray',
  '7890': 'Shari',
  '1234': 'Uber Admissions',
}

function parseSheet(workbook) {
  // Try to find the transactions sheet (first non-"Users" sheet, or first sheet)
  let sheetName = workbook.SheetNames.find(n => n.toLowerCase() !== 'users') ?? workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
  return { rows, sheetName }
}

function detectMonthYear(sheetName, rows) {
  // Try sheet name first (e.g. "Jan 2024", "January_2024", "2024-01")
  const monthMatch = sheetName.match(/(\w+)[_\s-]+(\d{4})/)
  if (monthMatch) {
    const m = MONTHS.findIndex(mo => mo.toLowerCase().startsWith(monthMatch[1].toLowerCase()))
    if (m !== -1) return { month: m + 1, year: parseInt(monthMatch[2]) }
  }
  // Try parsing dates from rows
  for (const row of rows.slice(0, 5)) {
    const dateStr = Object.values(row).find(v => /\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(String(v)))
    if (dateStr) {
      const d = new Date(dateStr)
      if (!isNaN(d)) return { month: d.getMonth() + 1, year: d.getFullYear() }
    }
  }
  return { month: new Date().getMonth() + 1, year: new Date().getFullYear() }
}

function normalizeRow(row) {
  // Flexible column mapping — handles various export formats
  const keys = Object.keys(row)
  const find = (...patterns) => {
    const k = keys.find(k => patterns.some(p => k.toLowerCase().includes(p)))
    return k ? row[k] : null
  }

  const dateRaw = find('date', 'trans date', 'posted')
  const date = dateRaw ? new Date(dateRaw) : null
  const validDate = date && !isNaN(date) ? date.toISOString().split('T')[0] : null

  const amount = parseFloat(String(find('amount', 'debit', 'charge', 'total') ?? '0').replace(/[^0-9.-]/g, ''))

  return {
    transaction_date: validDate,
    description: String(find('description', 'merchant', 'memo', 'name') ?? '').trim(),
    amount: isNaN(amount) ? 0 : Math.abs(amount),
    category: String(find('category', 'type') ?? '').trim() || 'Uncategorized',
    card_last4: String(find('card', 'last 4', 'last4', 'account') ?? '').replace(/\D/g, '').slice(-4),
    cardholder_name: String(find('cardholder', 'name', 'employee', 'user') ?? '').trim(),
  }
}

export default function Import() {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [facility, setFacility] = useState('CLE')
  const [month, setMonth] = useState(new Date().getMonth() + 1)
  const [year, setYear] = useState(new Date().getFullYear())
  const [status, setStatus] = useState(null) // null | 'importing' | 'done' | 'error'
  const [message, setMessage] = useState('')
  const [importedCount, setImportedCount] = useState(0)

  const handleFile = (e) => {
    const f = e.target.files[0]
    if (!f) return
    setFile(f)
    setStatus(null)
    setMessage('')

    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'array' })
        const { rows, sheetName } = parseSheet(wb)
        const detected = detectMonthYear(sheetName, rows)
        setMonth(detected.month)
        setYear(detected.year)

        // Build preview (first 5 rows)
        const normalized = rows.map(normalizeRow).filter(r => r.amount > 0)
        setPreview({ rows: normalized, total: normalized.length, sheetName })
      } catch (err) {
        setStatus('error')
        setMessage('Could not parse file: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(f)
  }

  const handleImport = async () => {
    if (!preview || !preview.rows.length) return
    setStatus('importing')
    setMessage('')

    try {
      // 1. Ensure facility exists
      let { data: facilityRow } = await supabase
        .from('facilities')
        .select('id')
        .eq('name', facility.trim().toUpperCase())
        .single()

      if (!facilityRow) {
        const { data: newFac, error: facErr } = await supabase
          .from('facilities')
          .insert({ name: facility.trim().toUpperCase() })
          .select('id')
          .single()
        if (facErr) throw facErr
        facilityRow = newFac
      }

      // 2. Create or get import record
      const { data: importRow, error: importErr } = await supabase
        .from('imports')
        .upsert({
          facility_id: facilityRow.id,
          statement_month: month,
          statement_year: year,
          filename: file.name,
        }, { onConflict: 'facility_id,statement_month,statement_year' })
        .select('id')
        .single()
      if (importErr) throw importErr

      // Delete existing transactions for this import (re-import support)
      await supabase.from('transactions').delete().eq('import_id', importRow.id)

      // 3. Insert transactions in batches of 100
      const txRows = preview.rows.map(r => ({
        import_id: importRow.id,
        facility_id: facilityRow.id,
        cardholder_name: r.cardholder_name || CARD_MAP[r.card_last4] || r.card_last4 || 'Unknown',
        transaction_date: r.transaction_date,
        description: r.description,
        amount: r.amount,
        category: r.category,
        card_last4: r.card_last4,
        statement_month: month,
        statement_year: year,
      }))

      const batchSize = 100
      for (let i = 0; i < txRows.length; i += batchSize) {
        const { error: txErr } = await supabase
          .from('transactions')
          .insert(txRows.slice(i, i + batchSize))
        if (txErr) throw txErr
      }

      setImportedCount(txRows.length)
      setStatus('done')
      setMessage(`Successfully imported ${txRows.length} transactions for ${MONTHS[month-1]} ${year} — ${facility}.`)
      setFile(null)
      setPreview(null)
      if (fileRef.current) fileRef.current.value = ''
    } catch (err) {
      setStatus('error')
      setMessage(err.message || 'Import failed.')
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">Import Statement</h1>
        <p className="text-gray-500 text-sm mt-1">Upload a monthly credit card statement Excel file.</p>
      </div>

      {/* Upload area */}
      <div className="card space-y-5">
        <div>
          <label className="label">Statement file (.xlsx)</label>
          <div
            className="border-2 border-dashed border-gray-700 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-500 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {file ? (
              <div>
                <p className="text-green-400 font-medium">{file.name}</p>
                <p className="text-gray-500 text-sm mt-1">Click to choose a different file</p>
              </div>
            ) : (
              <div>
                <p className="text-4xl mb-2">📂</p>
                <p className="text-gray-300 font-medium">Click to select your Excel statement</p>
                <p className="text-gray-600 text-sm mt-1">.xlsx files only</p>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xls"
            className="hidden"
            onChange={handleFile}
          />
        </div>

        {/* Metadata fields */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="label">Facility</label>
            <input
              className="input"
              value={facility}
              onChange={e => setFacility(e.target.value.toUpperCase())}
              placeholder="CLE"
            />
          </div>
          <div>
            <label className="label">Month</label>
            <select
              className="input"
              value={month}
              onChange={e => setMonth(parseInt(e.target.value))}
            >
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Year</label>
            <input
              className="input"
              type="number"
              value={year}
              onChange={e => setYear(parseInt(e.target.value))}
              min="2020"
              max="2030"
            />
          </div>
        </div>

        {/* Preview table */}
        {preview && (
          <div>
            <p className="text-sm text-gray-400 mb-2">
              Preview — {preview.total} transactions detected from sheet "{preview.sheetName}"
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500 bg-gray-800/50">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Description</th>
                    <th className="px-3 py-2">Cardholder</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className="border-t border-gray-800 hover:bg-gray-800/30">
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">{r.transaction_date ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-300 max-w-[200px] truncate">{r.description || '—'}</td>
                      <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                        {r.cardholder_name || CARD_MAP[r.card_last4] || r.card_last4 || '—'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="text-xs bg-indigo-900/50 text-indigo-300 px-2 py-0.5 rounded-full">
                          {r.category}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-green-400 font-mono">
                        ${r.amount.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {preview.total > 8 && (
                <p className="text-gray-600 text-xs px-3 py-2 border-t border-gray-800">
                  … and {preview.total - 8} more rows
                </p>
              )}
            </div>
          </div>
        )}

        {/* Status message */}
        {message && (
          <div className={`text-sm px-4 py-3 rounded-lg border ${
            status === 'done'
              ? 'bg-green-950/50 border-green-800 text-green-400'
              : 'bg-red-950/50 border-red-800 text-red-400'
          }`}>
            {message}
          </div>
        )}

        {/* Import button */}
        {preview && status !== 'done' && (
          <button
            className="btn-primary w-full"
            onClick={handleImport}
            disabled={status === 'importing'}
          >
            {status === 'importing'
              ? `Importing ${preview.total} transactions…`
              : `Import ${preview.total} transactions → ${MONTHS[month-1]} ${year} (${facility})`
            }
          </button>
        )}
      </div>

      {/* Tips */}
      <div className="card text-sm text-gray-500 space-y-1">
        <p className="text-gray-400 font-medium mb-2">Tips</p>
        <p>• The app reads column headers automatically — Date, Description, Amount, Category, Card/Cardholder are all detected.</p>
        <p>• Adding a "Facility" column to your sheet is optional — you can also set it in the field above.</p>
        <p>• Re-importing the same month + facility will replace those transactions, not duplicate them.</p>
        <p>• Card numbers are mapped to names (Chad, Meghan, Ray, Shari, Uber Admissions). Ask Ray to update the CARD_MAP in Import.jsx if cards change.</p>
      </div>
    </div>
  )
}
