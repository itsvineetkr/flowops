import { beforeEach, describe, expect, it } from 'vitest'
import type { Project } from '../api'
import { toGraph, useFlow, wouldCycle } from './flowStore'

const project: Project = { id: 1, name: 'p', stack: '', repo: '', created_at: '', flows: {} }
const s = () => useFlow.getState()
const nodes = () => s().canvases[s().kind].nodes

beforeEach(() => {
  s().load(project)
  s().setKind('dockerfile')
})

describe('undo/redo', () => {
  it('undoes and redoes adding a node', () => {
    s().addNode('run', { x: 0, y: 0 })
    expect(nodes()).toHaveLength(1)
    s().undo()
    expect(nodes()).toHaveLength(0)
    expect(s().selectedId).toBeNull() // selection of a node that no longer exists is cleared
    s().redo()
    expect(nodes()).toHaveLength(1)
  })

  it('collapses typing in one field into a single step', () => {
    s().addNode('run', { x: 0, y: 0 })
    const id = nodes()[0].id
    for (const command of ['n', 'np', 'npm', 'npm ci']) s().updateParams(id, { command })
    s().undo()
    expect(nodes()[0].data.params).toEqual({ command: '' }) // back to defaults in one undo
    s().undo()
    expect(nodes()).toHaveLength(0)
  })

  it('treats edits to a different field as a new step', () => {
    s().addNode('env', { x: 0, y: 0 })
    const id = nodes()[0].id
    s().updateParams(id, { key: 'A' })
    s().updateParams(id, { key: 'A', value: '1' })
    s().undo()
    expect(nodes()[0].data.params).toEqual({ key: 'A' })
  })

  it('records a drag once, at its start', () => {
    s().addNode('run', { x: 0, y: 0 })
    const id = nodes()[0].id
    for (const x of [10, 20, 30]) s().onNodesChange([{ type: 'position', id, position: { x, y: 0 }, dragging: true }])
    s().onNodesChange([{ type: 'position', id, position: { x: 30, y: 0 }, dragging: false }])
    expect(nodes()[0].position.x).toBe(30)
    s().undo()
    expect(nodes()[0].position.x).toBe(0)
  })

  it('ignores selection changes and keeps history per canvas', () => {
    s().addNode('run', { x: 0, y: 0 })
    s().onNodesChange([{ type: 'select', id: nodes()[0].id, selected: true }])
    expect(s().history.dockerfile.past).toHaveLength(1)
    s().setKind('compose')
    s().undo() // nothing to undo on compose
    s().setKind('dockerfile')
    expect(nodes()).toHaveLength(1)
  })

  it('a new edit clears the redo stack', () => {
    s().addNode('run', { x: 0, y: 0 })
    s().undo()
    s().addNode('expose', { x: 0, y: 0 })
    s().redo()
    expect(nodes().map((n) => n.data.nodeType)).toEqual(['expose'])
  })

  it('replace (import/template) is undoable and switches tab', () => {
    s().replace('pipeline', { nodes: [{ id: 't', type: 'trigger', params: {} }], edges: [] })
    expect(s().kind).toBe('pipeline')
    expect(toGraph(s().canvases.pipeline, false).nodes).toEqual([{ id: 't', type: 'trigger', params: {} }])
    s().undo()
    expect(s().canvases.pipeline.nodes).toHaveLength(0)
  })
})

describe('wouldCycle', () => {
  const edges = [
    { id: '1', source: 'a', target: 'b' },
    { id: '2', source: 'b', target: 'c' },
  ]
  it('detects cycles and self-loops', () => {
    expect(wouldCycle(edges, 'c', 'a')).toBe(true)
    expect(wouldCycle(edges, 'a', 'a')).toBe(true)
    expect(wouldCycle(edges, 'a', 'c')).toBe(false)
  })
})
