import Editor from '@monaco-editor/react'
import { useEffect, useState } from 'react'
import { api, type Graph } from '../../api'
import { toGraph, useFlow } from '../../store/flowStore'

function download(path: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: path.split('/').pop()! })
  a.click()
  URL.revokeObjectURL(url)
}

export function Preview({ target }: { target: string }) {
  const kind = useFlow((s) => s.kind)
  const setErrorNode = useFlow((s) => s.setErrorNode)
  // Positions don't affect output, so dragging nodes shouldn't trigger regeneration.
  const irKey = useFlow((s) => JSON.stringify(toGraph(s.canvases[s.kind], false)))
  const [files, setFiles] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    const graph = JSON.parse(irKey) as Graph
    let cancelled = false
    const t = setTimeout(async () => {
      if (!graph.nodes.length) {
        setFiles({})
        setError(null)
        setErrorNode(null)
        return
      }
      try {
        const res = await api.generate(target, graph)
        if (cancelled) return
        setFiles(res.files)
        setError(null)
        setErrorNode(null)
      } catch (e) {
        if (cancelled) return
        const msg = e instanceof Error ? e.message : String(e)
        setError(msg)
        setErrorNode(/node '([^']+)'/.exec(msg)?.[1] ?? null)
      }
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [irKey, kind, target, setErrorNode])

  const entries = Object.entries(files)

  return (
    <div className="flex h-full flex-col">
      {error && <div className="border-b border-red-900 bg-red-950/60 px-3 py-2 text-xs text-red-300">{error}</div>}
      {entries.length === 0 && !error && (
        <p className="p-4 text-sm text-slate-500">Add nodes to see the generated file.</p>
      )}
      {entries.map(([path, content]) => (
        <div key={path} className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-center justify-between border-b border-slate-800 px-3 py-1.5 text-xs">
            <span className="font-mono text-slate-300">{path}</span>
            <span className="flex gap-3">
              <button
                className="text-slate-400 hover:text-white"
                onClick={() =>
                  navigator.clipboard.writeText(content).then(() => {
                    setCopied(path)
                    setTimeout(() => setCopied(null), 1200)
                  })
                }
              >
                {copied === path ? 'Copied' : 'Copy'}
              </button>
              <button className="text-slate-400 hover:text-white" onClick={() => download(path, content)}>
                Download
              </button>
            </span>
          </div>
          <div className={`min-h-0 flex-1 ${error ? 'opacity-50' : ''}`}>
            <Editor
              language={path.endsWith('Dockerfile') ? 'dockerfile' : 'yaml'}
              value={content}
              theme="flowops-black"
              beforeMount={(monaco) => monaco.editor.defineTheme('flowops-black', {
                base: 'vs-dark',
                inherit: true,
                rules: [],
                colors: {
                  'editor.background': '#090909',
                  'editor.foreground': '#e5e5e5',
                  'editorLineNumber.foreground': '#737373',
                  'editor.selectionBackground': '#37306b',
                },
              })}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: '"SFMono-Regular", Consolas, monospace',
                lineHeight: 22,
                padding: { top: 12 },
                scrollBeyondLastLine: false,
                automaticLayout: true, // re-measure when panes are resized
              }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}
