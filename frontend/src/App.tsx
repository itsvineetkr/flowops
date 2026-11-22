import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import { api, ApiError, type User } from './api'
import { AuthPage } from './pages/AuthPage'
import { ProjectsPage } from './pages/ProjectsPage'
import { WelcomePage } from './pages/WelcomePage'
import { UserContext } from './userContext'

const EditorPage = lazy(() => import('./pages/EditorPage').then((m) => ({ default: m.EditorPage })))

function Shell({ user, onSignOut, children }: { user: User; onSignOut: () => void; children: ReactNode }) {
  const navCls = ({ isActive }: { isActive: boolean }) =>
    `rounded px-2 py-1 ${isActive ? 'text-white' : 'text-slate-400 hover:text-white'}`
  return (
    <div className="min-h-full">
      <header className="flex items-center gap-4 border-b border-slate-800 px-6 py-3 text-sm">
        <Link to="/landing" className="font-bold">
          Flow Ops
        </Link>
        <nav className="flex gap-1">
          <NavLink to="/" end className={navCls}>
            Projects
          </NavLink>
          <NavLink to="/welcome" className={navCls}>
            Connections
          </NavLink>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          {user.avatar_url && <img src={user.avatar_url} alt="" className="h-6 w-6 rounded-full" />}
          <span className="text-slate-300">{user.login}</span>
          {user.github_login ? (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-xs text-slate-400">@{user.github_login}</span>
          ) : (
            <Link to="/welcome" className="rounded bg-amber-900/60 px-1.5 py-0.5 text-xs text-amber-300 hover:bg-amber-900">
              Connect GitHub
            </Link>
          )}
          <button onClick={onSignOut} className="text-slate-400 hover:text-white">
            Sign out
          </button>
        </div>
      </header>
      {children}
    </div>
  )
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  useEffect(() => {
    api.me().then(setUser, (e) => {
      if (e instanceof ApiError && e.status === 401) setUser(null)
      else setError('Cannot reach the Flow Ops API. Is the backend running?')
    })
  }, [])

  const signOut = async () => {
    await api.logout()
    setUser(null)
    navigate('/')
  }

  if (error) return <p className="p-8 text-red-400">{error}</p>
  if (user === undefined) return null
  if (user === null) {
    return (
      <AuthPage
        onSignedIn={(u, isNew) => {
          setUser(u)
          navigate(isNew ? '/welcome' : '/', { replace: true })
        }}
      />
    )
  }

  return (
    <UserContext.Provider value={{ user, setUser }}>
      <Routes>
        <Route path="/landing" element={<AuthPage user={user} onSignOut={signOut} />} />
        <Route path="/" element={<Shell user={user} onSignOut={signOut}><ProjectsPage /></Shell>} />
        <Route path="/welcome" element={<Shell user={user} onSignOut={signOut}><WelcomePage /></Shell>} />
        <Route
          path="/p/:id"
          element={
            <Suspense fallback={<p className="p-8 text-slate-500">Loading editor…</p>}>
              <EditorPage />
            </Suspense>
          }
        />
      </Routes>
    </UserContext.Provider>
  )
}
