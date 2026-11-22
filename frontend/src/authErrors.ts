// Error codes the backend puts in ?error= after a GitHub redirect.
const MESSAGES: Record<string, string> = {
  github_denied: 'GitHub authorization was cancelled.',
  github_state: 'That GitHub sign-in link expired or was opened in another browser. Please try again.',
  github_failed: "Couldn't complete GitHub sign-in. Please try again.",
  github_in_use: 'That GitHub account is already connected to a different Flow Ops account.',
  signin_required: 'Please sign in first.',
}

export function authErrorFromUrl(): string | null {
  const code = new URLSearchParams(window.location.search).get('error')
  return code ? (MESSAGES[code] ?? 'Something went wrong. Please try again.') : null
}
