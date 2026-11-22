import { useEffect, useState } from 'react'
import { api, type Repo } from '../../api'
import { useUser } from '../../userContext'

/**
 * Repositories the user granted the Flow Ops GitHub App access to, plus a link to grant
 * more. GitHub sends the user back to the current page after they change access.
 */
export function useGitHubAccess() {
  const user = useUser()
  const [repos, setRepos] = useState<Repo[] | null>(null)
  const [installUrl, setInstallUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.authOptions().then((o) => setInstallUrl(o.github_install_url), () => {})
  }, [])

  useEffect(() => {
    if (!user?.has_github) return
    api.repos().then(setRepos, (e: Error) => setError(e.message))
  }, [user?.has_github])

  const grantHref = installUrl ? `${installUrl}?state=${encodeURIComponent(window.location.pathname)}` : null
  return { connected: !!user?.has_github, repos, grantHref, error }
}
