import type { Graph, Kind } from '../../api'
import { defOf } from '../../nodeCatalog'

/** On-disk format for exported canvases. */
export type FlowFile = { flowops: 1; kind: Kind; graph: Graph }

const KINDS: Kind[] = ['dockerfile', 'compose', 'pipeline']
export const FILE_SUFFIX = '.flowops.json'

export function exportFlow(kind: Kind, graph: Graph): string {
  return JSON.stringify({ flowops: 1, kind, graph } satisfies FlowFile, null, 2)
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Parses and validates an exported file. Throws an Error with a user-facing message. */
export function parseFlowFile(text: string): FlowFile {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error('Not a JSON file.')
  }
  if (!isObject(data) || data.flowops !== 1) throw new Error('Not a Flow Ops export (missing "flowops": 1).')
  const kind = data.kind as Kind
  if (!KINDS.includes(kind)) throw new Error(`Unknown canvas kind "${String(data.kind)}".`)
  const graph = data.graph
  if (!isObject(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error('File has no nodes/edges.')
  }
  const ids = new Set<string>()
  for (const n of graph.nodes) {
    if (!isObject(n) || typeof n.id !== 'string' || typeof n.type !== 'string') throw new Error('A node is missing its id or type.')
    if (!defOf(kind, n.type)) throw new Error(`Unknown ${kind} node type "${n.type}".`)
    if (ids.has(n.id)) throw new Error(`Duplicate node id "${n.id}".`)
    if (n.params !== undefined && !isObject(n.params)) throw new Error(`Node "${n.id}" has invalid params.`)
    ids.add(n.id)
  }
  for (const e of graph.edges) {
    if (!isObject(e) || !ids.has(e.source as string) || !ids.has(e.target as string)) {
      throw new Error('An edge points at a node that does not exist.')
    }
  }
  return {
    flowops: 1,
    kind,
    graph: {
      nodes: (graph.nodes as Record<string, unknown>[]).map((n) => ({
        id: n.id as string,
        type: n.type as string,
        params: (n.params as Record<string, unknown>) ?? {},
        ...(isObject(n.position) &&
          typeof n.position.x === 'number' &&
          typeof n.position.y === 'number' && { position: { x: n.position.x, y: n.position.y } }),
      })),
      edges: (graph.edges as Record<string, string>[]).map((e) => ({ source: e.source, target: e.target })),
    },
  }
}
