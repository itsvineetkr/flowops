import { useState, type FormEvent } from 'react'
import { api, type Kind, type PushResult } from '../../api'
import { toGraph, useFlow } from '../../store/flowStore'
import { useGitHubAccess } from './useGitHubAccess'

const KIND_FILES: Record<Kind, string> = {
  pipeline: '.github/workflows/ci.yml',
  dockerfile: 'Dockerfile',
  compose: 'docker-compose.yml',
}
const KINDS = Object.keys(KIND_FILES) as Kind[]
const inputCls =
  'w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm outline-none focus:border-indigo-400'

export function PushDialog({ defaultRepo, onClose }: { defaultRepo: string; onClose: () => void }) {
  const canvases = useFlow((s) => s.canvases)
  const nonEmpty = KINDS.filter((k) => canvases[k].nodes.length > 0)
  const { repos, grantHref, error: accessError } = useGitHubAccess()
  const [repo, setRepo] = useState(defaultRepo)
  const [branch, setBranch] = useState('flowops/config')
  const [message, setMessage] = useState('Add Docker and CI/CD configuration (Flow Ops)')
  const [openPr, setOpenPr] = useState(true)
  const [kinds, setKinds] = useState<Kind[]>(nonEmpty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<PushResult | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const graphs = Object.fromEntries(kinds.map((k) => [k, toGraph(canvases[k], false)]))
      setResult(await api.push({ repo: repo.trim(), branch, message, open_pr: openPr, graphs }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-[30rem] rounded-xl bg-slate-900 p-6 ring-1 ring-slate-700" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-4 text-lg font-semibold">Push to GitHub</h2>
        {result ? (
          <div className="space-y-3 text-sm">
            <p>
              Committed {result.files.length} file{result.files.length > 1 && 's'} to{' '}
              <span className="font-mono">{result.branch}</span>.
            </p>
            <ul className="font-mono text-xs text-slate-400">
              {result.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            <div className="flex gap-4">
              <a href={result.commit_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
                View commit
              </a>
              {result.pr_url && (
                <a href={result.pr_url} target="_blank" rel="noreferrer" className="text-indigo-300 hover:underline">
                  View pull request
                </a>
              )}
            </div>
            <button onClick={onClose} className="mt-2 rounded-lg bg-slate-800 px-4 py-1.5 hover:bg-slate-700">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Repository</span>
              <select required value={repo} onChange={(e) => setRepo(e.target.value)} className={inputCls}>
                <option value="">{repos === null ? 'Loading repositories…' : 'Choose a repository…'}</option>
                {repos?.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                  </option>
                ))}
              </select>
              {grantHref && (
                <a href={grantHref} className="mt-1 inline-block text-xs text-indigo-300 hover:underline">
                  {repos?.length ? 'Not listed? Grant access to another repository' : 'Grant Flow Ops access to a repository'}
                </a>
              )}
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Branch</span>
              <input required value={branch} onChange={(e) => setBranch(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Commit message</span>
              <input required value={message} onChange={(e) => setMessage(e.target.value)} className={inputCls} />
            </label>
            <fieldset>
              <span className="mb-1 block text-xs text-slate-400">Files</span>
              {KINDS.map((k) => (
                <label key={k} className={`flex items-center gap-2 text-sm ${nonEmpty.includes(k) ? '' : 'text-slate-600'}`}>
                  <input
                    type="checkbox"
                    disabled={!nonEmpty.includes(k)}
                    checked={kinds.includes(k)}
                    onChange={(e) => setKinds(e.target.checked ? [...kinds, k] : kinds.filter((x) => x !== k))}
                  />
                  <span className="font-mono">{KIND_FILES[k]}</span>
                  {!nonEmpty.includes(k) && <span className="text-xs">(empty canvas)</span>}
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={openPr} onChange={(e) => setOpenPr(e.target.checked)} />
              Open a pull request
            </label>
            {(error ?? accessError) && (
              <p className="rounded bg-red-950/60 px-3 py-2 text-xs text-red-300">{error ?? accessError}</p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="rounded-lg px-4 py-1.5 text-sm text-slate-400 hover:text-white">
                Cancel
              </button>
              <button
                disabled={busy || !repo || kinds.length === 0}
                className="rounded-lg bg-indigo-500 px-4 py-1.5 text-sm font-medium hover:bg-indigo-400 disabled:opacity-50"
              >
                {busy ? 'Pushing…' : 'Push'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
