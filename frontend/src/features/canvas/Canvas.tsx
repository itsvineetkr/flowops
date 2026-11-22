import {
  Background,
  Controls,
  MiniMap,
  Panel,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Connection,
  type Edge,
} from '@xyflow/react'
import { useCallback, useEffect, useRef, type DragEvent, type RefObject } from 'react'
import type { Kind } from '../../api'
import { useFlow, wouldCycle } from '../../store/flowStore'
import { FlowNodeView } from './FlowNodeView'

export const DND_MIME = 'application/x-flowops-node'
const nodeTypes = { flow: FlowNodeView }
const FIT_OPTIONS = { padding: 0.2, maxZoom: 1 }

/**
 * Keeps the flow centered: fits when a canvas is first shown (per tab, and after load/import),
 * and again whenever the canvas resizes (panes restoring saved sizes, dragging a divider, window
 * resize), until the user pans or zooms themselves.
 */
function useAutoFit(container: RefObject<HTMLDivElement | null>, kind: Kind, nodeCount: number) {
  const { fitView } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  const fitRequest = useFlow((s) => s.fitRequest)
  const fittedFor = useRef<string | null>(null)
  const userMoved = useRef(false)
  const key = `${kind}:${fitRequest}`

  const fit = useCallback(() => {
    if (!userMoved.current) requestAnimationFrame(() => fitView(FIT_OPTIONS))
  }, [fitView])

  useEffect(() => {
    if (fittedFor.current === key) return
    userMoved.current = false
    if (nodeCount === 0) {
      fittedFor.current = key // empty canvas: don't jump when the first node is added
    } else if (nodesInitialized) {
      fittedFor.current = key
      fit()
    }
  }, [key, nodeCount, nodesInitialized, fit])

  useEffect(() => {
    const el = container.current
    if (!el) return
    const observer = new ResizeObserver(() => fit())
    observer.observe(el)
    return () => observer.disconnect()
  }, [container, fit])

  // `event` is null for programmatic moves (our own fitView), set for user pan/zoom.
  return (event: MouseEvent | TouchEvent | null) => {
    if (event) userMoved.current = true
  }
}

export function Canvas() {
  const { kind, canvases, onNodesChange, onEdgesChange, onConnect, addNode, select } = useFlow()
  const { nodes, edges } = canvases[kind]
  const { screenToFlowPosition } = useReactFlow()
  const container = useRef<HTMLDivElement>(null)
  const onMoveStart = useAutoFit(container, kind, nodes.length)

  const onDrop = (e: DragEvent) => {
    e.preventDefault()
    const type = e.dataTransfer.getData(DND_MIME)
    if (type) addNode(type, screenToFlowPosition({ x: e.clientX, y: e.clientY }))
  }

  const isValidConnection = (c: Connection | Edge) =>
    !!c.source && !!c.target && !wouldCycle(edges, c.source, c.target)

  return (
    <div ref={container} className="h-full w-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        isValidConnection={isValidConnection}
        onDrop={onDrop}
        onDragOver={(e) => {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
        }}
        onNodeClick={(_, n) => select(n.id)}
        onPaneClick={() => select(null)}
        deleteKeyCode={['Backspace', 'Delete']}
        connectOnClick
        connectionRadius={48}
        defaultEdgeOptions={{ style: { strokeWidth: 2 }, interactionWidth: 24 }}
        connectionLineStyle={{ strokeWidth: 2 }}
        colorMode="dark"
        onMoveStart={onMoveStart}
      >
        <Background gap={24} size={1} />
        <Panel position="top-center" className="canvas-hint rounded-lg border border-slate-800 bg-slate-900/95 px-3 py-2 text-center text-xs text-slate-400">
          {nodes.length === 0
            ? 'Start by adding a step from the left panel.'
            : 'Connect steps: drag between ports, or click an output then an input.'}
        </Panel>
        <Controls />
        <MiniMap pannable zoomable />
      </ReactFlow>
    </div>
  )
}
