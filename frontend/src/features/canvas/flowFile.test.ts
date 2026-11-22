import { describe, expect, it } from 'vitest'
import { exportFlow, parseFlowFile } from './flowFile'

const graph = {
  nodes: [
    { id: 'f', type: 'from', params: { image: 'alpine' }, position: { x: 1, y: 2 } },
    { id: 'r', type: 'run', params: { command: 'ls' } },
  ],
  edges: [{ source: 'f', target: 'r' }],
}

describe('flow files', () => {
  it('round-trips an export', () => {
    expect(parseFlowFile(exportFlow('dockerfile', graph))).toEqual({ flowops: 1, kind: 'dockerfile', graph })
  })

  it.each([
    ['nope', /Not a JSON/],
    ['{"kind":"dockerfile"}', /Not a Flow Ops export/],
    ['{"flowops":1,"kind":"helm","graph":{"nodes":[],"edges":[]}}', /Unknown canvas kind/],
    ['{"flowops":1,"kind":"dockerfile","graph":{"nodes":[{"id":"a","type":"trigger"}],"edges":[]}}', /Unknown dockerfile node type/],
    ['{"flowops":1,"kind":"dockerfile","graph":{"nodes":[{"id":"a","type":"run"},{"id":"a","type":"run"}],"edges":[]}}', /Duplicate/],
    ['{"flowops":1,"kind":"dockerfile","graph":{"nodes":[{"id":"a","type":"run"}],"edges":[{"source":"a","target":"x"}]}}', /does not exist/],
  ])('rejects %s', (text, error) => {
    expect(() => parseFlowFile(text)).toThrow(error)
  })

  it('drops unknown fields and defaults params', () => {
    const f = parseFlowFile('{"flowops":1,"kind":"dockerfile","graph":{"nodes":[{"id":"a","type":"run","evil":1}],"edges":[]}}')
    expect(f.graph.nodes).toEqual([{ id: 'a', type: 'run', params: {} }])
  })
})
