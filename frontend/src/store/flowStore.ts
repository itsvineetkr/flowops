import { create } from 'zustand'
import {
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
} from '@xyflow/react'
import type { Graph, Kind, Project } from '../api'
import { defOf } from '../nodeCatalog'

export type NodeData = { nodeType: string; params: Record<string, unknown> }
export type FlowNode = Node<NodeData, 'flow'>
export type Canvas = { nodes: FlowNode[]; edges: Edge[] }

const KINDS: Kind[] = ['dockerfile', 'compose', 'pipeline']

export function fromGraph(g?: Graph): Canvas {
  if (!g) return { nodes: [], edges: [] }
  return {
    nodes: g.nodes.map((n, i) => ({
      id: n.id,
      type: 'flow',
      position: n.position ?? { x: 0, y: i * 100 },
      data: { nodeType: n.type, params: n.params },
    })),
    edges: g.edges.map((e) => ({ id: `${e.source}->${e.target}`, source: e.source, target: e.target })),
  }
}

export function toGraph(c: Canvas, withPositions = true): Graph {
  return {
    nodes: c.nodes.map((n) => ({
      id: n.id,
      type: n.data.nodeType,
      params: n.data.params,
      ...(withPositions && { position: { x: Math.round(n.position.x), y: Math.round(n.position.y) } }),
    })),
    edges: c.edges.map((e) => ({ source: e.source, target: e.target })),
  }
}

/** True if adding source -> target would close a cycle (target already reaches source). */
export function wouldCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true
  const stack = [target]
  const seen = new Set<string>()
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === source) return true
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const e of edges) if (e.source === cur) stack.push(e.target)
  }
  return false
}

type History = { past: Canvas[]; future: Canvas[] }
const HISTORY_LIMIT = 100
const COALESCE_MS = 1000
const emptyHistory = (): Record<Kind, History> => ({
  dockerfile: { past: [], future: [] },
  compose: { past: [], future: [] },
  pipeline: { past: [], future: [] },
})

type State = {
  kind: Kind
  canvases: Record<Kind, Canvas>
  history: Record<Kind, History>
  selectedId: string | null
  errorNodeId: string | null
  /** Bumped when a whole canvas is swapped in (load, import), so the view re-centers. */
  fitRequest: number
  load: (p: Project) => void
  setKind: (k: Kind) => void
  /** Replaces a whole canvas (template or import); undoable. */
  replace: (k: Kind, g: Graph) => void
  onNodesChange: (changes: NodeChange<FlowNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (c: Connection) => void
  addNode: (type: string, position: { x: number; y: number }) => void
  updateParams: (id: string, params: Record<string, unknown>) => void
  undo: () => void
  redo: () => void
  select: (id: string | null) => void
  setErrorNode: (id: string | null) => void
}

export const useFlow = create<State>((set, get) => {
  // Consecutive edits with the same key (typing in one field) collapse into one undo step.
  let lastCommit = { key: '', at: 0 }
  let dragging = false

  /** Snapshot the active canvas onto the undo stack before a change. */
  const record = (key = '') => {
    const now = Date.now()
    const coalesce = key !== '' && key === lastCommit.key && now - lastCommit.at < COALESCE_MS
    lastCommit = { key, at: now }
    if (coalesce) return
    set((s) => {
      const h = s.history[s.kind]
      return {
        history: {
          ...s.history,
          [s.kind]: { past: [...h.past, s.canvases[s.kind]].slice(-HISTORY_LIMIT), future: [] },
        },
      }
    })
  }

  const patch = (fn: (c: Canvas) => Partial<Canvas>) =>
    set((s) => ({ canvases: { ...s.canvases, [s.kind]: { ...s.canvases[s.kind], ...fn(s.canvases[s.kind]) } } }))

  const travel = (from: 'past' | 'future') =>
    set((s) => {
      const h = s.history[s.kind]
      const stack = h[from]
      if (!stack.length) return {}
      const target = stack[stack.length - 1]
      const to = from === 'past' ? 'future' : 'past'
      lastCommit = { key: '', at: 0 }
      return {
        canvases: { ...s.canvases, [s.kind]: target },
        history: { ...s.history, [s.kind]: { [from]: stack.slice(0, -1), [to]: [...h[to], s.canvases[s.kind]] } as History },
        selectedId: target.nodes.some((n) => n.id === s.selectedId) ? s.selectedId : null,
      }
    })

  return {
    kind: 'pipeline',
    canvases: { dockerfile: fromGraph(), compose: fromGraph(), pipeline: fromGraph() },
    history: emptyHistory(),
    selectedId: null,
    errorNodeId: null,
    fitRequest: 0,
    load: (p) =>
      set((s) => ({
        fitRequest: s.fitRequest + 1,
        canvases: Object.fromEntries(KINDS.map((k) => [k, fromGraph(p.flows[k])])) as Record<Kind, Canvas>,
        history: emptyHistory(),
        selectedId: null,
        errorNodeId: null,
      })),
    setKind: (kind) => set({ kind, selectedId: null, errorNodeId: null }),
    replace: (k, g) => {
      if (k !== get().kind) set({ kind: k })
      record()
      set((s) => ({ canvases: { ...s.canvases, [k]: fromGraph(g) }, selectedId: null, fitRequest: s.fitRequest + 1 }))
    },
    onNodesChange: (changes) => {
      // Selection and measurement changes aren't edits; removals are; a drag records once, when it starts.
      const removes = changes.some((ch) => ch.type === 'remove')
      const dragStart = changes.some((ch) => ch.type === 'position' && ch.dragging) && !dragging
      if (changes.some((ch) => ch.type === 'position')) dragging = changes.some((ch) => ch.type === 'position' && ch.dragging)
      if (removes || dragStart) record()
      patch((c) => ({ nodes: applyNodeChanges(changes, c.nodes) }))
      const sel = get().selectedId
      if (sel && changes.some((ch) => ch.type === 'remove' && ch.id === sel)) set({ selectedId: null })
    },
    onEdgesChange: (changes) => {
      if (changes.some((ch) => ch.type === 'remove')) record()
      patch((c) => ({ edges: applyEdgeChanges(changes, c.edges) }))
    },
    onConnect: (conn) => {
      record()
      patch((c) => ({ edges: addEdge({ ...conn, id: `${conn.source}->${conn.target}` }, c.edges) }))
    },
    addNode: (type, position) => {
      const def = defOf(get().kind, type)
      if (!def) return
      record()
      const id = `${type}-${crypto.randomUUID().slice(0, 6)}`
      const node: FlowNode = { id, type: 'flow', position, data: { nodeType: type, params: structuredClone(def.defaults) } }
      patch((c) => ({ nodes: [...c.nodes, node] }))
      set({ selectedId: id })
    },
    updateParams: (id, params) => {
      // key includes the changed fields, so typing in one field is one undo step
      const before = get().canvases[get().kind].nodes.find((n) => n.id === id)?.data.params ?? {}
      const changed = Object.keys({ ...before, ...params }).filter((k) => before[k] !== params[k]).sort().join(',')
      record(`params:${id}:${changed}`)
      patch((c) => ({ nodes: c.nodes.map((n) => (n.id === id ? { ...n, data: { ...n.data, params } } : n)) }))
    },
    undo: () => travel('past'),
    redo: () => travel('future'),
    select: (selectedId) => set({ selectedId }),
    setErrorNode: (errorNodeId) => set({ errorNodeId }),
  }
})
