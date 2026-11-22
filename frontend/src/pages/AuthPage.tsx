import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type AuthOptions, type User } from '../api'
import { authErrorFromUrl } from '../authErrors'

const inputCls =
  'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-3 text-sm outline-none focus:border-indigo-400'

function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className="h-4 w-4 fill-current">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

type AuthPageProps =
  | { user: User; onSignOut: () => Promise<void>; onSignedIn?: never }
  | { user?: undefined; onSignOut?: never; onSignedIn: (u: User, isNew: boolean) => void }

export function AuthPage({ onSignedIn, user, onSignOut }: AuthPageProps) {
  const [mode, setMode] = useState<'signin' | 'register'>('signin')
  const [opts, setOpts] = useState<AuthOptions | null>(null)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(authErrorFromUrl)

  useEffect(() => {
    if (user) return
    api.authOptions().then(setOpts, () => setOpts({ github: false, dev_login: false, github_install_url: null }))
  }, [user])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const user = mode === 'register' ? await api.register(name, email, password) : await api.login(email, password)
      onSignedIn?.(user, mode === 'register')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const switchMode = (m: typeof mode) => {
    setMode(m)
    setError(null)
  }

  return (
    <div className="auth-landing min-h-full">
      <main className="mx-auto grid max-w-7xl items-center gap-12 px-6 py-8 lg:grid-cols-[1.2fr_1fr] lg:gap-20 lg:px-10 lg:py-16">
        <section aria-labelledby="landing-title">
          <div className="landing-intro">
            <p className="landing-eyebrow">Your visual DevOps workspace</p>
            <h1 id="landing-title" className="landing-wordmark">Flow <span>Ops</span></h1>
            <p className="landing-tagline">
              Connect the steps.<br /><span>Build your workflow.</span>
            </p>
          </div>
          <p className="mt-6 max-w-lg text-base leading-relaxed text-slate-400 sm:text-lg">
            Turn your ideas into CI/CD pipelines, Dockerfiles, and Compose configurations.
            Build visually, review the generated code, and send it to GitHub.
          </p>
          <div className="landing-flow mt-9 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/70 p-5 sm:p-6" role="img" aria-label="Example workflow: a push to main triggers dependency installation, then tests. The workflow generates a GitHub Actions configuration.">
            <div aria-hidden="true">
              <div className="mb-6 flex items-center justify-between gap-3 text-xs text-slate-400">
                <span className="font-mono">my-first-pipeline</span>
                <span className="rounded-md border border-slate-700 px-2 py-1">Workflow preview</span>
              </div>
              <div className="flex items-center">
                <div className="min-w-0 flex-1 rounded-xl border border-emerald-400/45 bg-emerald-400/10 p-3">
                  <div className="text-sm font-semibold">Trigger</div><div className="mt-1 truncate font-mono text-xs text-slate-400">push: main</div>
                </div>
                <div className="h-px w-5 shrink-0 bg-slate-600 sm:w-8" />
                <div className="min-w-0 flex-1 rounded-xl border border-sky-400/45 bg-sky-400/10 p-3">
                  <div className="text-sm font-semibold">Install</div><div className="mt-1 truncate font-mono text-xs text-slate-400">npm ci</div>
                </div>
                <div className="h-px w-5 shrink-0 bg-slate-600 sm:w-8" />
                <div className="min-w-0 flex-1 rounded-xl border border-indigo-400/45 bg-indigo-400/10 p-3">
                  <div className="text-sm font-semibold">Test</div><div className="mt-1 truncate font-mono text-xs text-slate-400">npm test</div>
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-4 text-xs text-slate-400">
                <span>Visual steps. Real configuration.</span><span className="font-mono text-indigo-300">ci.yml</span>
              </div>
            </div>
          </div>
          <dl className="mt-7 grid gap-5 sm:grid-cols-3">
            <div><dt className="text-sm font-semibold">Build visually</dt><dd className="mt-1 text-sm leading-relaxed text-slate-400">Connect steps on a flexible canvas.</dd></div>
            <div><dt className="text-sm font-semibold">See the code</dt><dd className="mt-1 text-sm leading-relaxed text-slate-400">Review configuration as you build.</dd></div>
            <div><dt className="text-sm font-semibold">Make it yours</dt><dd className="mt-1 text-sm leading-relaxed text-slate-400">Export files or open a GitHub PR.</dd></div>
          </dl>
        </section>
      <section id="account" aria-labelledby="account-title" className="w-full scroll-mt-6 rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl sm:p-8">
        {user ? (
          <>
            <p className="mb-4 text-sm font-medium text-indigo-300">You’re signed in</p>
            <h2 id="account-title" className="text-2xl font-semibold">Welcome back, {user.login}</h2>
            <div className="my-6 flex items-center gap-4 rounded-xl border border-slate-800 bg-slate-950 p-4">
              {user.avatar_url && <img src={user.avatar_url} alt="" className="h-12 w-12 rounded-full" />}
              <div className="min-w-0">
                <p className="break-words font-medium">{user.login}</p>
                {user.email && <p className="break-all text-sm text-slate-400">{user.email}</p>}
                {user.github_login && <p className="text-sm text-slate-400">GitHub · @{user.github_login}</p>}
              </div>
            </div>
            <p className="mb-6 text-sm leading-relaxed text-slate-400">Your workspace is ready. Continue an existing workflow or start something new.</p>
            <Link to="/" className="block rounded-lg bg-indigo-500 px-4 py-3 text-center font-medium hover:bg-indigo-400">Go to your projects</Link>
            <button disabled={busy} onClick={async () => {
              setBusy(true)
              setError(null)
              try { await onSignOut?.() }
              catch { setError('Could not log out. Please try again.') }
              finally { setBusy(false) }
            }} className="mt-3 w-full rounded-lg border border-slate-700 px-4 py-3 text-sm hover:bg-slate-800 disabled:opacity-50">{busy ? 'Logging out…' : 'Log out'}</button>
            {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
          </>
        ) : (
          <>
        <h2 id="account-title" className="text-2xl font-semibold tracking-tight">{mode === 'register' ? 'Create your workspace' : 'Welcome back'}</h2>
        <p className="mt-2 mb-7 text-sm leading-relaxed text-slate-400">{mode === 'register' ? 'Start building your first workflow with Flow Ops.' : 'Sign in to pick up where your workflow left off.'}</p>

        <div role="tablist" className="mb-5 grid grid-cols-2 rounded-lg bg-slate-950 p-1 text-sm">
          {(['signin', 'register'] as const).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`rounded-md py-1.5 ${mode === m ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white'}`}
            >
              {m === 'signin' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === 'register' && (
            <label className="block">
              <span className="mb-1 block text-sm text-slate-300">Name</span>
              <input required autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Email</span>
            <input
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-sm text-slate-300">Password</span>
            <input
              required
              type="password"
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={inputCls}
            />
            {mode === 'register' && <span className="mt-1 block text-xs text-slate-500">At least 8 characters.</span>}
          </label>
          {error && (
            <p role="alert" className="rounded bg-red-950/60 px-3 py-2 text-sm text-red-300">
              {error}
            </p>
          )}
          <button disabled={busy} className="w-full rounded-lg bg-indigo-500 py-3 font-medium hover:bg-indigo-400 disabled:opacity-50">
            {busy ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        {(opts?.github || opts?.dev_login) && (
          <div className="my-5 flex items-center gap-3 text-xs text-slate-500">
            <span className="h-px flex-1 bg-slate-800" />
            or
            <span className="h-px flex-1 bg-slate-800" />
          </div>
        )}
        {opts?.github && (
          <a
            href="/api/auth/login"
            className="flex items-center justify-center gap-2 rounded-lg bg-white px-4 py-3 font-medium text-slate-900 hover:bg-slate-200"
          >
            <GitHubMark /> Continue with GitHub
          </a>
        )}
        {opts?.dev_login && (
          <form method="post" action="/api/auth/dev-login" className="mt-3">
            <button className="w-full rounded-lg bg-slate-800 px-4 py-2 text-sm hover:bg-slate-700">Dev login</button>
          </form>
        )}
        <p className="mt-6 border-t border-slate-800 pt-5 text-center text-xs leading-relaxed text-slate-400">Start with email or GitHub. You choose which repositories to connect.</p>
          </>
        )}
      </section>
      </main>
      <footer className="mx-auto max-w-7xl px-6 pt-4 pb-8 text-sm text-slate-500 lg:px-10">Flow Ops · From connected steps to configuration.</footer>
    </div>
  )
}
