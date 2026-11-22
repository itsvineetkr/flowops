import { api, type ImageTag } from '../../api'

const cache = new Map<string, Promise<ImageTag[]>>()

/** Tags for an image, cached per session. `q` searches all tags; without it, the recent ones. */
export function loadTags(image: string, q = ''): Promise<ImageTag[]> {
  const key = `${image.toLowerCase()}:${q.toLowerCase()}`
  let hit = cache.get(key)
  if (!hit) {
    hit = api.imageTags(image, q).catch((e) => {
      cache.delete(key) // don't cache failures
      throw e
    })
    cache.set(key, hit)
  }
  return hit
}

const versionKey = (v: string) => v.split(/[^0-9]+/).filter(Boolean).map(Number)

/** Numeric version compare, newest first: 3.15 > 3.9 > 3. */
export function compareVersionsDesc(a: string, b: string): number {
  const x = versionKey(a)
  const y = versionKey(b)
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (y[i] ?? -1) - (x[i] ?? -1)
    if (d) return d
  }
  return 0
}

/** Hide pre-releases and Windows images unless the user is clearly asking for them. */
export function isVisible(t: ImageTag, typed: string): boolean {
  if (t.prerelease && !/rc|alpha|beta|\d[ab]\d|dev|nightly|edge/i.test(typed)) return false
  if (t.windows && !/windows|nano|ltsc/i.test(typed)) return false
  return true
}

/** Exact match, then prefix matches, then newest version, then shortest name. */
export function rankTags(tags: ImageTag[], typed: string): ImageTag[] {
  const q = typed.toLowerCase()
  // exact tag, then tags of exactly the typed version (3.12-slim before 3.12.15-slim), then prefix matches
  const score = (t: ImageTag) => (t.name === q ? 0 : t.version === q ? 1 : t.name.startsWith(q) ? 2 : 3)
  return [...tags].sort(
    (a, b) => score(a) - score(b) || compareVersionsDesc(a.version, b.version) || a.name.length - b.name.length,
  )
}

const MAX_TAGS = 40

/** Everything the tag builder shows, derived from recent tags + full-search results for what's typed. */
export function buildTagPicker(recent: ImageTag[], searched: ImageTag[], typed: string) {
  const recentStable = recent.filter((t) => isVisible(t, ''))
  // Search results reach old versions (e.g. python 3.8) that recent tags don't cover.
  const stable = [...new Map([...recentStable, ...searched.filter((t) => isVisible(t, ''))].map((t) => [t.name, t])).values()]

  const pool = new Map<string, ImageTag>()
  for (const t of recent) if (t.name.includes(typed)) pool.set(t.name, t)
  for (const t of searched) pool.set(t.name, t)
  const tagList = rankTags([...pool.values()].filter((t) => isVisible(t, typed)), typed).slice(0, MAX_TAGS)

  // Chips reflect the current tag when it's an exact match.
  const current = pool.get(typed)
  // Images with several major lines (node 26/24/22, postgres 18/17) pick by major;
  // single-major images (python 3) pick by minor (3.15, 3.14, ...).
  const numeric = recentStable.filter((t) => /^\d+(\.\d+)*$/.test(t.version))
  const majors = new Set(numeric.map((t) => t.version.split('.')[0]))
  const depth = majors.size >= 3 ? 1 : 2
  const versions = [...new Set(numeric.filter((t) => t.version.split('.').length === depth).map((t) => t.version))]
    .sort(compareVersionsDesc)
    .slice(0, 10)
  const variantSource = current?.version ? stable.filter((t) => t.version === current.version) : stable.filter((t) => !t.version)
  const variants = [...new Set(variantSource.map((t) => t.variant))]
    .filter((v) => current?.version || v) // without a version, "" would just be "latest"
    .sort((a, b) => a.length - b.length || a.localeCompare(b))
    .slice(0, 12)
  const hasLatest = stable.some((t) => t.name === 'latest')

  /** Tag to use when a version chip is clicked: keep the current variant if that combination exists. */
  const tagForVersion = (version: string) => {
    const candidates = stable.filter((t) => t.version === version)
    return (candidates.find((t) => t.variant === (current?.variant ?? '')) ?? candidates.find((t) => !t.variant) ?? candidates[0])?.name
  }
  /** Tag to use when a variant chip is clicked, for the current version (or standalone tags like "slim"). */
  const tagForVariant = (variant: string) =>
    (current?.version
      ? stable.find((t) => t.version === current.version && t.variant === variant)
      : stable.find((t) => !t.version && t.variant === variant)
    )?.name

  return { tagList, current, versions, variants, hasLatest, tagForVersion, tagForVariant }
}

const DEBIAN: Record<string, string> = { trixie: 'Debian 13', bookworm: 'Debian 12', bullseye: 'Debian 11', buster: 'Debian 10' }
const UBUNTU: Record<string, string> = {
  resolute: 'Ubuntu 26.04',
  noble: 'Ubuntu 24.04',
  jammy: 'Ubuntu 22.04',
  focal: 'Ubuntu 20.04',
}

/** Plain-English explanation of a tag variant like "slim-bookworm" or "alpine3.20". */
export function describeVariant(variant: string): string {
  if (!variant) return "The image's default variant, usually the full one: largest, but most compatible."
  const parts = variant.split('-')
  const debian = parts.find((p) => p in DEBIAN)
  const slim = parts.includes('slim')
  const out: string[] = []
  if (slim) out.push(`Minimal ${debian ? DEBIAN[debian] : 'Debian'}: much smaller, a good default for production`)
  else if (debian) out.push(`Full ${DEBIAN[debian]}`)
  for (const p of parts) {
    if (p === 'slim' || p in DEBIAN) continue
    const alpine = /^alpine(\d+\.\d+)?$/.exec(p)
    if (alpine) out.push(`Alpine Linux${alpine[1] ? ` ${alpine[1]}` : ''}: smallest; uses musl, so some native packages need compiling`)
    else if (p in UBUNTU) out.push(UBUNTU[p])
    else if (p === 'jre') out.push('Java runtime only (smaller, for running apps)')
    else if (p === 'jdk') out.push('Full Java development kit')
    else if (p === 'lts') out.push('Long-term-support release line')
    else if (p === 'current') out.push('Newest release line')
    else if (/^(windowsservercore|nanoserver|ltsc\d+)$/.test(p)) out.push('Windows container')
    else out.push(p)
  }
  return out.join(' · ')
}

export function formatSize(bytes: number): string {
  if (!bytes) return ''
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`
}

export function formatAge(iso: string): string {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000)
  if (Number.isNaN(days)) return ''
  if (days < 1) return 'today'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
