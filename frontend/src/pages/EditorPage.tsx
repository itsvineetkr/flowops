import { ReactFlowProvider } from '@xyflow/react'
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { Link, useParams } from 'react-router-dom'
import { api, type Graph, type Kind, type Platform, type Project } from '../api'
import { Canvas } from '../features/canvas/Canvas'
import { FILE_SUFFIX, exportFlow, parseFlowFile } from '../features/canvas/flowFile'
import { Palette } from '../features/canvas/Palette'
import { ParamPanel } from '../features/canvas/ParamPanel'
import { Preview } from '../features/canvas/Preview'
import { PushDialog } from '../features/github/PushDialog'
import { toGraph, useFlow } from '../store/flowStore'
import { useUser } from '../userContext'

function ResizeHandle({ vertical = false }: { vertical?: boolean }) {
  return (
    <PanelResizeHandle
      className={`${vertical ? 'h-1' : 'w-1'} bg-slate-800 transition-colors hover:bg-indigo-500 data-[resize-handle-state=drag]:bg-indigo-500`}
    />
  )
}

const TABS: { kind: Kind; label: string }[] = [
  { kind: 'pipeline', label: 'CI/CD Pipeline' },
  { kind: 'dockerfile', label: 'Dockerfile' },
  { kind: 'compose', label: 'Compose' },
]

type SaveStatus = 'saved' | 'saving' | 'error'

/**
 * Debounced save of the active canvas; only fires when the graph differs from what's on the server.
 * A pending save is flushed immediately on tab switch, navigation away, or page close.
 */
function useAutosave(projectId: number, ready: boolean) {
  const kind = useFlow((s) => s.kind)
  const saveKey = useFlow((s) => JSON.stringify(toGraph(s.canvases[s.kind])))
  const saved = useRef<Partial<Record<Kind, string>>>({})
  const pending = useRef<{ kind: Kind; body: string } | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')

  const flush = useCallback(
    (keepalive = false) => {
      const p = pending.current
      if (!p) return
      pending.current = null
      api
        .saveFlow(projectId, p.kind, JSON.parse(p.body) as Graph, keepalive)
        .then(() => {
          saved.current[p.kind] = p.body
          if (!pending.current) setStatus('saved')
        })
        .catch(() => setStatus('error'))
    },
    [projectId],
  )

  useEffect(() => {
    if (!ready) return
    if (saved.current[kind] === undefined) {
      saved.current[kind] = saveKey // first view of this tab: baseline, nothing to save
      return
    }
    if (saved.current[kind] === saveKey) return
    pending.current = { kind, body: saveKey }
    setStatus('saving')
    const t = setTimeout(() => flush(), 800)
    return () => clearTimeout(t)
  }, [saveKey, kind, ready, flush])

  // Leaving this tab or page: send whatever is pending now instead of dropping it.
  useEffect(() => () => flush(true), [kind, flush])
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && flush(true)
    const onUnload = () => flush(true)
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', onUnload)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', onUnload)
    }
  }, [flush])

  return status
}

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && !!el.closest('input, textarea, select, [contenteditable="true"], .monaco-editor')

/** Cmd/Ctrl+Z undo, Shift+Cmd/Ctrl+Z or Ctrl+Y redo, outside text fields. */
function useUndoShortcuts() {
  const { undo, redo } = useFlow()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || isTyping(e.target)) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) undo()
      else if ((key === 'z' && e.shiftKey) || key === 'y') redo()
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])
}

function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  Object.assign(document.createElement('a'), { href: url, download: name }).click()
  URL.revokeObjectURL(url)
}

const headerBtn = 'rounded px-2 py-1 text-sm text-slate-300 hover:bg-slate-800 disabled:opacity-30 disabled:hover:bg-transparent'

export function EditorPage() {
  const projectId = Number(useParams().id)
  const [project, setProject] = useState<Project | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [platforms, setPlatforms] = useState<Platform[]>([])
  const [platform, setPlatform] = useState('github')
  const { kind, setKind, load, undo, redo, replace } = useFlow()
  const canUndo = useFlow((s) => s.history[s.kind].past.length > 0)
  const canRedo = useFlow((s) => s.history[s.kind].future.length > 0)
  const status = useAutosave(projectId, project !== null)
  useUndoShortcuts()
  const user = useUser()
  const [pushing, setPushing] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const importInput = useRef<HTMLInputElement>(null)

  const exportCurrent = () => {
    const { canvases } = useFlow.getState()
    const slug = project?.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'flow'
    download(`${slug}-${kind}${FILE_SUFFIX}`, exportFlow(kind, toGraph(canvases[kind])))
  }

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-importing the same file
    if (!file) return
    try {
      const flow = parseFlowFile(await file.text())
      const target = useFlow.getState().canvases[flow.kind]
      if (target.nodes.length && !confirm(`Replace the current ${flow.kind} canvas? You can undo this.`)) return
      replace(flow.kind, flow.graph)
      setImportError(null)
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err))
    }
  }

  useEffect(() => {
    setProject(null)
    api.project(projectId).then(
      (p) => {
        load(p)
        setProject(p)
      },
      (e: Error) => setLoadError(e.message),
    )
    api.platforms().then(setPlatforms)
  }, [projectId, load])

  if (loadError) return <p className="p-8 text-red-400">{loadError}</p>
  if (!project) return <p className="p-8 text-slate-500">Loading…</p>

  const ciPlatforms = platforms.filter((p) => !['dockerfile', 'compose'].includes(p.key))
  const target = kind === 'pipeline' ? platform : kind

  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-slate-800 bg-slate-900 px-4 py-3">
          <Link to="/" className="text-sm text-slate-400 hover:text-white">
            ← Projects
          </Link>
          <h1 className="font-semibold">{project.name}</h1>
          <nav className="ml-4 flex gap-1">
            {TABS.map((t) => (
              <button
                key={t.kind}
                onClick={() => setKind(t.kind)}
                className={`rounded px-3 py-1 text-sm ${kind === t.kind ? 'bg-slate-700' : 'text-slate-400 hover:bg-slate-800'}`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          {kind === 'pipeline' && (
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm"
            >
              {ciPlatforms.map((p) => (
                <option key={p.key} value={p.key} disabled={!p.available}>
                  {p.label}
                  {!p.available && ' (coming soon)'}
                </option>
              ))}
            </select>
          )}
          <div className="ml-auto flex items-center gap-1">
            <button onClick={undo} disabled={!canUndo} title="Undo (⌘Z)" className={headerBtn}>
              ↶ Undo
            </button>
            <button onClick={redo} disabled={!canRedo} title="Redo (⇧⌘Z)" className={headerBtn}>
              ↷ Redo
            </button>
            <span className="mx-1 h-4 w-px bg-slate-700" />
            <button onClick={() => importInput.current?.click()} title="Import a .flowops.json file" className={headerBtn}>
              Import
            </button>
            <input ref={importInput} type="file" accept=".json,application/json" hidden onChange={importFile} />
            <button onClick={exportCurrent} title="Download this canvas as JSON" className={headerBtn}>
              Export
            </button>
          </div>
          <span className={`text-xs ${status === 'error' ? 'text-red-400' : 'text-slate-500'}`}>
            {status === 'saving' ? 'Saving…' : status === 'error' ? 'Save failed' : 'Saved'}
          </span>
          <button
            onClick={() => setPushing(true)}
            disabled={!user?.has_github}
            title={user?.has_github ? undefined : 'Connect GitHub on the Connections page to push'}
            className="rounded-lg bg-indigo-500 px-3 py-1 text-sm font-medium hover:bg-indigo-400 disabled:opacity-40"
          >
            Push to GitHub
          </button>
        </header>
        {importError && (
          <div className="flex items-center justify-between bg-red-950/60 px-4 py-1.5 text-sm text-red-300">
            <span>Import failed: {importError}</span>
            <button onClick={() => setImportError(null)} className="text-red-400 hover:text-white">
              Dismiss
            </button>
          </div>
        )}
        {pushing && <PushDialog defaultRepo={project.repo} onClose={() => setPushing(false)} />}
        {/* autoSaveId remembers pane sizes per browser */}
        <PanelGroup direction="horizontal" autoSaveId="flowops-editor" className="min-h-0 flex-1">
          <Panel defaultSize={14} minSize={10} maxSize={30}>
            <Palette />
          </Panel>
          <ResizeHandle />
          <Panel minSize={25}>
            <main className="h-full">
              <Canvas />
            </main>
          </Panel>
          <ResizeHandle />
          <Panel defaultSize={30} minSize={18} maxSize={65}>
            <PanelGroup direction="vertical" autoSaveId="flowops-sidebar">
              <Panel defaultSize={40} minSize={10}>
                <div className="h-full overflow-y-auto">
                  <ParamPanel />
                </div>
              </Panel>
              <ResizeHandle vertical />
              <Panel minSize={15}>
                <Preview target={target} />
              </Panel>
            </PanelGroup>
          </Panel>
        </PanelGroup>
      </div>
    </ReactFlowProvider>
  )
}
