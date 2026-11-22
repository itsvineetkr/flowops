import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type RepoAnalysis, type TemplateSummary } from '../../api'
import { useGitHubAccess } from '../github/useGitHubAccess'

type Props = {
  value: string | null
  onChange: (key: string | null) => void
  repo: string
  onRepoChange: (repo: string) => void
  onHintsChange: (hints: Record<string, string>) => void
}

const HINT_LABELS: Record<string, string> = {
  django_module: 'Django module',
  dotnet_assembly: '.NET assembly',
  rust_binary: 'Rust binary',
  angular_project: 'Angular project',
  node_main: 'Entry file',
}

const selectCls =
  'w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm outline-none focus:border-indigo-400'

function RepoSection({ repo, onRepoChange, analysis, analyzing, error }: {
  repo: string
  onRepoChange: (repo: string) => void
  analysis: RepoAnalysis | null
  analyzing: boolean
  error: string | null
}) {
  const { connected, repos, grantHref, error: accessError } = useGitHubAccess()
  const grantLink = (label: string) =>
    grantHref ? (
      <a href={grantHref} className="text-sm text-indigo-300 hover:underline">
        {label}
      </a>
    ) : (
      <span className="text-xs text-amber-400">GITHUB_APP_SLUG is not configured on the backend.</span>
    )

  if (!connected) {
    return (
      <p className="text-sm text-slate-500">
        <Link to="/welcome" className="text-indigo-300 hover:underline">
          Connect GitHub
        </Link>{' '}
        to analyze a repository and get a recommended setup.
      </p>
    )
  }
  if (accessError) return <p className="text-sm text-red-400">{accessError}</p>
  if (repos === null) return <p className="text-sm text-slate-500">Loading repositories…</p>
  if (repos.length === 0) {
    return (
      <div className="space-y-1">
        <p className="text-sm text-slate-400">Flow Ops doesn't have access to any of your repositories yet.</p>
        {grantLink('Grant access to a repository →')}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <select value={repo} onChange={(e) => onRepoChange(e.target.value)} className={selectCls}>
          <option value="">Choose a repository to analyze…</option>
          {repos.map((r) => (
            <option key={r.full_name} value={r.full_name}>
              {r.full_name}
              {r.private ? ' (private)' : ''}
            </option>
          ))}
        </select>
        <span className="shrink-0">{grantLink('Grant another repo')}</span>
      </div>
      {analyzing && <p className="text-sm text-slate-400">Analyzing {repo}…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {analysis && !analyzing && (
        <div className="rounded-lg bg-slate-900 p-3 text-sm ring-1 ring-slate-800">
          <div className="flex items-center gap-2">
            <span className="font-medium">{analysis.repo.full_name}</span>
            {analysis.repo.language && (
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-300">{analysis.repo.language}</span>
            )}
          </div>
          {analysis.repo.description && <p className="mt-1 text-slate-400">{analysis.repo.description}</p>}
          <p className="mt-2 text-xs text-slate-500">
            {analysis.repo.manifests.length
              ? `Looked at: ${analysis.repo.manifests.join(', ')}`
              : 'No manifest files found on the default branch.'}
          </p>
          {Object.keys(analysis.hints).length > 0 && (
            <p className="mt-1 text-xs text-slate-400">
              Detected:{' '}
              {Object.entries(analysis.hints)
                .map(([k, v]) => `${HINT_LABELS[k] ?? k} ${v}`)
                .join(' · ')}
              . These are filled into the template.
            </p>
          )}
          {analysis.recommendations.length === 0 && (
            <p className="mt-2 text-amber-400">Couldn't guess the stack. Pick a template below.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function TemplatePicker({ value, onChange, repo, onRepoChange, onHintsChange }: Props) {
  const [templates, setTemplates] = useState<TemplateSummary[]>([])
  const [analysis, setAnalysis] = useState<RepoAnalysis | null>(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef('')

  useEffect(() => {
    api.templates().then(setTemplates)
  }, [])

  const selectRepo = async (full: string) => {
    onRepoChange(full)
    latest.current = full
    setAnalysis(null)
    setError(null)
    onHintsChange({})
    if (!full) return
    setAnalyzing(true)
    try {
      const result = await api.recommendFromRepo(full)
      if (latest.current !== full) return // user picked another repo meanwhile
      setAnalysis(result)
      onHintsChange(result.hints)
      if (result.recommendations.length) onChange(result.recommendations[0].key)
    } catch (e) {
      if (latest.current === full) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (latest.current === full) setAnalyzing(false)
    }
  }

  const recs = analysis?.recommendations ?? []
  const recByKey = new Map(recs.map((r, i) => [r.key, { ...r, rank: i }]))
  const sorted = [...templates].sort((a, b) => (recByKey.get(a.key)?.rank ?? 99) - (recByKey.get(b.key)?.rank ?? 99))
  const card = (selected: boolean) =>
    `rounded-lg p-3 text-left ring-1 ${selected ? 'bg-indigo-950 ring-indigo-400' : 'bg-slate-900 ring-slate-800 hover:ring-slate-600'}`

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">GitHub repository</h2>
        <RepoSection repo={repo} onRepoChange={selectRepo} analysis={analysis} analyzing={analyzing} error={error} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-slate-300">Template</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          <button type="button" onClick={() => onChange(null)} className={card(value === null)}>
            <div className="font-medium">Blank</div>
            <div className="text-xs text-slate-500">Start from an empty canvas</div>
          </button>
          {sorted.map((t) => {
            const rec = recByKey.get(t.key)
            const badge = !rec ? null : rec.score === 0 ? 'Possible match' : rec.rank === 0 ? 'Best match' : 'Match'
            return (
              <button type="button" key={t.key} onClick={() => onChange(t.key)} title={t.description} className={card(value === t.key)}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  {badge && (
                    <span className="shrink-0 rounded bg-emerald-900 px-1.5 py-0.5 text-[10px] text-emerald-300">{badge}</span>
                  )}
                </div>
                <div className="text-xs text-slate-500">{rec ? rec.reasons.join(' · ') : `${t.language} · ${t.category}`}</div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}
