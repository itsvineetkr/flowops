import { useReactFlow } from '@xyflow/react'
import { CATEGORY_COLOR, defsFor } from '../../nodeCatalog'
import { useFlow } from '../../store/flowStore'
import { DND_MIME } from './Canvas'

export function Palette() {
  const kind = useFlow((s) => s.kind)
  const addNode = useFlow((s) => s.addNode)
  const nodeCount = useFlow((s) => s.canvases[s.kind].nodes.length)
  const { screenToFlowPosition } = useReactFlow()
  const defs = defsFor(kind)
  const categories = [...new Set(defs.map((d) => d.category))]

  // Click-to-add drops the node near the canvas center, staggered so nodes don't stack.
  const addAtCenter = (type: string) => {
    const pos = screenToFlowPosition({ x: window.innerWidth / 2 - 200, y: 160 })
    addNode(type, { x: pos.x, y: pos.y + nodeCount * 30 })
  }

  return (
    <aside className="h-full overflow-y-auto p-3">
      <p className="mb-3 text-xs text-slate-500">Drag onto the canvas, or click to add.</p>
      {categories.map((cat) => (
        <div key={cat} className="mb-4">
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{cat}</h3>
          {defs
            .filter((d) => d.category === cat)
            .map((d) => (
              <button
                key={d.type}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DND_MIME, d.type)
                  e.dataTransfer.effectAllowed = 'move'
                }}
                onClick={() => addAtCenter(d.type)}
                className={`mb-1.5 block w-full cursor-grab rounded-lg border px-2.5 py-1.5 text-left text-sm ${CATEGORY_COLOR[cat]}`}
              >
                {d.label}
              </button>
            ))}
        </div>
      ))}
    </aside>
  )
}
