import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, type Kind, type Project } from '../api'
import { TemplatePicker } from '../features/templates/TemplatePicker'
import { useUser } from '../userContext'

export function ProjectsPage() {
  const [projects, setProjects] = useState<Project[] | null>(null)
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [template, setTemplate] = useState<string | null>(null)
  const [repo, setRepo] = useState('')
  const [hints, setHints] = useState<Record<string, string>>({})
  const [creating, setCreating] = useState(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const user = useUser()

  useEffect(() => {
    api.projects().then(setProjects)
  }, [])

  const create = async (e: FormEvent) => {
    e.preventDefault()
    if (creating) return
    if (!name.trim()) {
      setNameError(true)
      nameInput.current?.focus()
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const p = await api.createProject(name.trim(), template ?? '', repo)
      if (template) {
        const t = await api.template(template, hints)
        await Promise.all(
          (Object.entries(t.flows) as [Kind, (typeof t.flows)[Kind]][]).map(([kind, g]) => api.saveFlow(p.id, kind, g)),
        )
      }
      navigate(`/p/${p.id}`)
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }

  const remove = async (p: Project) => {
    if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return
    await api.deleteProject(p.id)
    setProjects((ps) => ps?.filter((x) => x.id !== p.id) ?? null)
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <h1 className="mb-6 text-2xl font-bold">Projects</h1>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_280px] xl:grid-cols-[minmax(0,1fr)_320px]">
        <aside aria-labelledby="existing-projects-title" className="min-w-0 rounded-2xl border border-slate-800 bg-slate-900/50 p-4 lg:col-start-2 lg:row-start-2 lg:sticky lg:top-6">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 id="existing-projects-title" className="font-semibold">Your projects</h2>
            {projects && <span className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{projects.length}</span>}
          </div>
          {projects === null && <p className="py-3 text-sm text-slate-400" role="status">Loading projects…</p>}
          {projects?.length === 0 && <p className="py-3 text-sm text-slate-400">No projects yet. Create your first project to get started.</p>}
          <ul className="space-y-2 lg:max-h-[calc(100dvh-220px)] lg:overflow-y-auto">
            {projects?.map((p) => (
              <li key={p.id} className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 transition-colors hover:border-slate-600">
                <Link to={`/p/${p.id}`} className="min-w-0 flex-1 rounded-lg px-3 py-3 hover:text-indigo-300">
                  <span className="block break-words font-medium">{p.name}</span>
                  {p.stack && <span className="mt-1 block break-words text-xs text-slate-400">{p.stack}</span>}
                </Link>
                <button onClick={() => remove(p)} aria-label={`Delete ${p.name}`} className="mr-2 shrink-0 rounded-md px-2 py-2 text-xs text-slate-400 hover:bg-red-950/50 hover:text-red-400">
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </aside>
        <section aria-labelledby="create-project-title" className="min-w-0 lg:contents">
          <div className="lg:col-start-1 lg:row-start-1">
          <h2 id="create-project-title" className="mb-2 text-xl font-semibold">Create a new project</h2>
          <p className="text-sm text-slate-400">Start with a template or build your own workflow from scratch.</p>
      {!user?.has_github && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl bg-indigo-950/50 px-4 py-3 text-sm ring-1 ring-indigo-900">
          <span>Connect GitHub to analyze your repositories and push generated files as pull requests.</span>
          <Link to="/welcome" className="shrink-0 rounded-lg bg-indigo-500 px-3 py-1.5 font-medium hover:bg-indigo-400">
            Connect GitHub
          </Link>
        </div>
      )}
      </div>
      <form onSubmit={create} className="mt-5 lg:mt-0 lg:col-start-1 lg:row-start-2 rounded-xl bg-slate-900/50 p-4 ring-1 ring-slate-800">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row">
          <input
            ref={nameInput}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              if (e.target.value.trim()) setNameError(false)
            }}
            placeholder="New project name"
            aria-invalid={nameError}
            aria-describedby={nameError ? 'name-error' : undefined}
            aria-label="New project name"
            className={`min-w-0 flex-1 rounded-lg border bg-slate-900 px-3 py-2 outline-none ${
              nameError ? 'border-amber-500 focus:border-amber-400' : 'border-slate-700 focus:border-indigo-400'
            }`}
          />
          <button
            disabled={creating}
            className="rounded-lg bg-indigo-500 px-4 py-2 font-medium hover:bg-indigo-400 disabled:opacity-50"
          >
            {creating ? 'Creating…' : 'Create'}
          </button>
        </div>
        {nameError && (
          <p id="name-error" role="alert" className="-mt-2 mb-4 text-sm text-amber-400">
            ⚠ Enter a project name to create a project.
          </p>
        )}
        {createError && <p className="-mt-2 mb-4 text-sm text-red-400">{createError}</p>}
        <TemplatePicker
          value={template}
          onChange={setTemplate}
          repo={repo}
          onRepoChange={setRepo}
          onHintsChange={setHints}
        />
      </form>
      </section>
      </div>
    </div>
  )
}
