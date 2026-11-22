import { useState, type FormEvent, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { authErrorFromUrl } from '../authErrors'
import { useGitHubAccess } from '../features/github/useGitHubAccess'
import { useSetUser, useUser } from '../userContext'

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-indigo-400'

function Step(props: { n: number; title: string; done: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <section
      className={`rounded-xl bg-slate-900 p-5 ring-1 ${props.done ? 'ring-emerald-800' : 'ring-slate-800'} ${
        props.disabled ? 'opacity-50' : ''
      }`}
    >
      <h2 className="mb-3 flex items-center gap-3 font-semibold">
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
            props.done ? 'bg-emerald-600 text-white' : 'bg-slate-700'
          }`}
        >
          {props.done ? '✓' : props.n}
        </span>
        {props.title}
      </h2>
      {props.children}
    </section>
  )
}

/** Shown after sign-up, and later as "Connections": link GitHub, then choose which repos Flow Ops can use. */
export function WelcomePage() {
  const user = useUser()!
  const setUser = useSetUser()
  const { connected, repos, grantHref, error: accessError } = useGitHubAccess()
  const [error, setError] = useState<string | null>(authErrorFromUrl)
  const [notice, setNotice] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const disconnect = async () => {
    if (!confirm('Disconnect GitHub? Flow Ops will no longer be able to read or push to your repositories.')) return
    try {
      const res = await api.disconnectGitHub()
      setUser(res)
      setNotice('GitHub disconnected. To also remove the Flow Ops app from your repositories, uninstall it in your GitHub settings.')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const addEmail = async (e: FormEvent) => {
    e.preventDefault()
    try {
      setUser(await api.addEmail(email, password))
      setNotice('Email sign-in added.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const granted = repos?.length ?? 0

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-8">
      <div>
        <h1 className="text-2xl font-bold">Connect GitHub</h1>
        <p className="mt-1 text-sm text-slate-400">
          Flow Ops analyzes your repositories to suggest a setup, and pushes the generated files as a pull request.
          You choose exactly which repositories it can see.
        </p>
      </div>
      {error && (
        <p role="alert" className="rounded-lg bg-red-950/60 px-4 py-2 text-sm text-red-300">
          {error}
        </p>
      )}
      {notice && <p className="rounded-lg bg-emerald-950/60 px-4 py-2 text-sm text-emerald-300">{notice}</p>}

      <Step n={1} title="Connect your GitHub account" done={connected}>
        {connected ? (
          <div className="flex items-center justify-between gap-4 text-sm">
            <span>
              Connected as <span className="font-mono">@{user.github_login}</span>
            </span>
            {user.has_password ? (
              <button onClick={disconnect} className="text-slate-400 hover:text-red-400">
                Disconnect
              </button>
            ) : (
              <span className="text-xs text-slate-500">Add email sign-in below to be able to disconnect.</span>
            )}
          </div>
        ) : (
          <>
            <p className="mb-3 text-sm text-slate-400">This only shares your GitHub identity. No repository access yet.</p>
            <a
              href="/api/auth/github/connect?next=/welcome"
              className="inline-block rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-200"
            >
              Connect GitHub
            </a>
          </>
        )}
      </Step>

      <Step n={2} title="Choose repositories" done={connected && granted > 0} disabled={!connected}>
        <p className="mb-3 text-sm text-slate-400">
          On GitHub, pick <b>All repositories</b> or <b>Only select repositories</b>. You can change this at any time.
        </p>
        {connected && accessError && <p className="mb-3 text-sm text-red-400">{accessError}</p>}
        {connected && repos === null && !accessError && <p className="mb-3 text-sm text-slate-500">Loading…</p>}
        {connected && granted > 0 && (
          <ul className="mb-3 max-h-48 space-y-1 overflow-y-auto rounded-lg bg-slate-950 p-3 text-sm">
            {repos!.map((r) => (
              <li key={r.full_name} className="flex justify-between gap-2">
                <span className="font-mono">{r.full_name}</span>
                <span className="text-xs text-slate-500">
                  {[r.language, r.private ? 'private' : ''].filter(Boolean).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
        )}
        {connected &&
          (grantHref ? (
            <a
              href={grantHref}
              className="inline-block rounded-lg bg-indigo-500 px-4 py-2 text-sm font-medium hover:bg-indigo-400"
            >
              {granted > 0 ? 'Change repository access' : 'Choose repositories on GitHub'}
            </a>
          ) : (
            <p className="text-xs text-amber-400">GITHUB_APP_SLUG is not configured on the backend.</p>
          ))}
      </Step>

      {!user.email && (
        <Step n={3} title="Add email sign-in (optional)" done={false}>
          <p className="mb-3 text-sm text-slate-400">Lets you sign in without GitHub, and disconnect GitHub later.</p>
          <form onSubmit={addEmail} className="flex flex-wrap gap-2">
            <input
              required
              type="email"
              placeholder="Email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={`${inputCls} flex-1`}
            />
            <input
              required
              type="password"
              minLength={8}
              placeholder="Password (8+ characters)"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${inputCls} flex-1`}
            />
            <button className="rounded-lg bg-slate-700 px-4 py-2 text-sm hover:bg-slate-600">Add</button>
          </form>
        </Step>
      )}

      <div className="flex justify-end pt-2">
        <Link to="/" className="rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">
          {connected && granted > 0 ? 'Continue to projects →' : 'Skip for now →'}
        </Link>
      </div>
    </div>
  )
}
