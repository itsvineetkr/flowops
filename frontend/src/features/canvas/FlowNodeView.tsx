import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CATEGORY_COLOR, defOf } from '../../nodeCatalog'
import { useFlow, type FlowNode } from '../../store/flowStore'

function summary(value: unknown): string {
  if (Array.isArray(value)) return value.join(' ')
  if (value && typeof value === 'object') return Object.keys(value).join(', ')
  return value == null ? '' : String(value)
}

export function FlowNodeView({ id, data, selected }: NodeProps<FlowNode>) {
  const kind = useFlow((s) => s.kind)
  const hasError = useFlow((s) => s.errorNodeId === id)
  const def = defOf(kind, data.nodeType)
  const first = def?.fields[0]
  const detail = first ? summary(data.params[first.key]) : ''
  const missing = def?.fields.some((f) => f.required && summary(data.params[f.key]) === '')

  return (
    <div
      className={`flow-node min-w-48 max-w-64 rounded-xl border px-4 py-5 text-sm shadow-lg ring-offset-2 ring-offset-slate-950 ${
        CATEGORY_COLOR[def?.category ?? ''] ?? 'border-slate-700 bg-slate-900'
      } ${hasError ? 'ring-2 ring-red-500' : selected ? 'ring-2 ring-indigo-400' : ''}`}
    >
      <Handle type="target" position={Position.Top} className="flow-port" title="Input: connect an output here" aria-label="Input connection" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold">{def?.label ?? data.nodeType}</span>
        {missing && <span className="text-xs text-amber-400" title="Required settings missing">●</span>}
      </div>
      {detail && <div className="mt-0.5 truncate font-mono text-xs text-slate-400">{detail}</div>}
      <Handle type="source" position={Position.Bottom} className="flow-port" title="Output: drag to an input, or click then click an input" aria-label="Output connection" />
    </div>
  )
}
