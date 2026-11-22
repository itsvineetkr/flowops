export type Kind = 'dockerfile' | 'compose' | 'pipeline'
export type IRNode = { id: string; type: string; params: Record<string, unknown>; position?: { x: number; y: number } }
export type Graph = { nodes: IRNode[]; edges: { source: string; target: string }[] }
export type Project = {
  id: number
  name: string
  stack: string
  repo: string
  created_at: string
  flows: Partial<Record<Kind, Graph>>
}
export type Platform = { key: string; label: string; available: boolean }
export type User = {
  id: number
  login: string // display name
  email: string | null
  avatar_url: string
  has_password: boolean
  github_login: string | null
  has_github: boolean
}
export type Repo = { full_name: string; default_branch: string; private: boolean; description: string; language: string }
export type PushResult = { branch: string; files: string[]; commit_url: string; pr_url: string | null }
export type PushRequest = {
  repo: string
  branch: string
  message: string
  open_pr: boolean
  graphs: Partial<Record<Kind, Graph>>
}
export type AuthOptions = { github: boolean; dev_login: boolean; github_install_url: string | null }
export type TemplateSummary = { key: string; name: string; language: string; category: string; description: string }
export type Template = TemplateSummary & {
  placeholders: Record<string, { default: string; label: string }>
  flows: Record<Kind, Graph>
}
export type Recommendation = TemplateSummary & { score: number; reasons: string[] }
export type RepoAnalysis = {
  repo: { full_name: string; description: string; language: string; default_branch: string; manifests: string[] }
  recommendations: Recommendation[]
  hints: Record<string, string> // template placeholder values guessed from the repo
}
export type ImageHit = { name: string; description: string; official: boolean; stars: number; pulls: number }
export type ImageTag = {
  name: string
  version: string // "" for tags like "slim" or "latest"
  variant: string // "" for plain version tags
  prerelease: boolean
  windows: boolean
  size: number // compressed linux/amd64 bytes
  updated: string
}

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function detailMessage(detail: unknown): string {
  if (typeof detail === 'string') return detail
  // FastAPI request-validation errors: [{loc, msg, ...}]
  if (Array.isArray(detail)) return detail.map((d) => d?.msg ?? JSON.stringify(d)).join('; ')
  return JSON.stringify(detail)
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = detailMessage((await res.json()).detail)
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, msg)
  }
  return res.status === 204 ? (undefined as T) : res.json()
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) })

export const api = {
  authOptions: () => req<AuthOptions>('/api/auth/options'),
  me: () => req<User>('/api/auth/me'),
  register: (name: string, email: string, password: string) =>
    req<User>('/api/auth/register', json('POST', { name, email, password })),
  login: (email: string, password: string) => req<User>('/api/auth/login', json('POST', { email, password })),
  logout: () => req<void>('/api/auth/logout', { method: 'POST' }),
  addEmail: (email: string, password: string) => req<User>('/api/auth/email', json('POST', { email, password })),
  disconnectGitHub: () => req<User & { manage_url: string }>('/api/auth/github/disconnect', { method: 'POST' }),
  projects: () => req<Project[]>('/api/projects'),
  project: (id: number) => req<Project>(`/api/projects/${id}`),
  createProject: (name: string, stack = '', repo = '') =>
    req<Project>('/api/projects', json('POST', { name, stack, repo })),
  deleteProject: (id: number) => req<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  // keepalive lets a save started while the page unloads still complete
  saveFlow: (id: number, kind: Kind, graph: Graph, keepalive = false) =>
    req(`/api/projects/${id}/flows/${kind}`, { ...json('PUT', graph), keepalive }),
  platforms: () => req<Platform[]>('/api/platforms'),
  templates: () => req<TemplateSummary[]>('/api/templates'),
  template: (key: string, hints: Record<string, string> = {}) =>
    req<Template>(`/api/templates/${key}?${new URLSearchParams(hints)}`),
  repos: () => req<Repo[]>('/api/github/repos'),
  recommendFromRepo: (repo: string) => req<RepoAnalysis>('/api/github/recommend', json('POST', { repo })),
  searchImages: (q: string) => req<ImageHit[]>(`/api/dockerhub/search?q=${encodeURIComponent(q)}`),
  imageTags: (image: string, q = '') =>
    req<ImageTag[]>(`/api/dockerhub/tags?image=${encodeURIComponent(image)}&q=${encodeURIComponent(q)}`),
  push: (body: PushRequest) => req<PushResult>('/api/github/push', json('POST', body)),
  generate: (target: string, graph: Graph) =>
    req<{ files: Record<string, string> }>('/api/generate', json('POST', { target, graph })),
}
