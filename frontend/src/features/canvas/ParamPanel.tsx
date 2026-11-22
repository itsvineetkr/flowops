import { useState } from 'react'
import { defOf, type Field } from '../../nodeCatalog'
import { useFlow } from '../../store/flowStore'
import { ImageInput } from './ImageInput'

const inputCls =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-indigo-400'

/** Free-text editor for structured values; parses on blur so separators can be typed freely. */
function DraftInput(props: { value: string; placeholder?: string; multiline?: boolean; onCommit: (s: string) => void }) {
  const [draft, setDraft] = useState(props.value)
  const common = {
    value: draft,
    placeholder: props.placeholder,
    className: inputCls,
    onBlur: () => props.onCommit(draft),
  }
  return props.multiline ? (
    <textarea rows={4} {...common} onChange={(e) => setDraft(e.target.value)} />
  ) : (
    <input {...common} onChange={(e) => setDraft(e.target.value)} />
  )
}

function FieldInput({ field, value, onChange }: { field: Field; value: unknown; onChange: (v: unknown) => void }) {
  switch (field.type) {
    case 'number':
      return (
        <input
          type="number"
          className={inputCls}
          placeholder={field.placeholder}
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
        />
      )
    case 'image':
      return (
        <ImageInput
          className={inputCls}
          placeholder={field.placeholder}
          value={String(value ?? '')}
          onChange={onChange}
        />
      )
    case 'select':
      return (
        <select className={inputCls} value={String(value ?? '')} onChange={(e) => onChange(e.target.value)}>
          {field.options!.map((o) => (
            <option key={o} value={o}>
              {o || '—'}
            </option>
          ))}
        </select>
      )
    case 'multi': {
      const selected = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {field.options!.map((o) => (
            <label key={o} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={selected.includes(o)}
                onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((s) => s !== o))}
              />
              {o}
            </label>
          ))}
        </div>
      )
    }
    case 'list': {
      const sep = field.sep ?? ','
      const text = Array.isArray(value) ? value.join(sep === ' ' ? ' ' : `${sep} `) : ''
      return (
        <DraftInput
          key={text}
          value={text}
          placeholder={field.placeholder}
          onCommit={(s) => onChange(s.split(sep).map((t) => t.trim()).filter(Boolean))}
        />
      )
    }
    case 'kv': {
      const obj = (value && typeof value === 'object' ? value : {}) as Record<string, string>
      const text = Object.entries(obj).map(([k, v]) => `${k}=${v}`).join('\n')
      return (
        <DraftInput
          key={text}
          multiline
          value={text}
          placeholder={field.placeholder}
          onCommit={(s) => {
            const entries = s
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line.includes('='))
              .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()])
            onChange(Object.fromEntries(entries))
          }}
        />
      )
    }
    default:
      return (
        <input
          className={inputCls}
          placeholder={field.placeholder}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

const isEmpty = (v: unknown) =>
  v === undefined || v === '' || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 0)

export function ParamPanel() {
  const { kind, canvases, selectedId, updateParams } = useFlow()
  const node = canvases[kind].nodes.find((n) => n.id === selectedId)
  const def = node && defOf(kind, node.data.nodeType)

  if (!node || !def) {
    return <p className="p-4 text-sm text-slate-500">Select a node to edit its settings.</p>
  }

  const setField = (key: string, value: unknown) => {
    const next = { ...node.data.params }
    if (isEmpty(value)) delete next[key]
    else next[key] = value
    updateParams(node.id, next)
  }

  return (
    <div className="p-4">
      <h2 className="font-semibold">{def.label}</h2>
      <p className="mb-4 font-mono text-xs text-slate-500">{node.id}</p>
      {def.fields.length === 0 && <p className="text-sm text-slate-500">No settings for this step.</p>}
      {def.fields.map((f) => (
        <label key={f.key} className="mb-3 block">
          <span className="mb-1 block text-xs text-slate-400">
            {f.label}
            {f.required && <span className="text-amber-400"> *</span>}
          </span>
          <FieldInput field={f} value={node.data.params[f.key]} onChange={(v) => setField(f.key, v)} />
        </label>
      ))}
    </div>
  )
}
