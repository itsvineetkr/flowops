import { useEffect, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api, type ImageHit, type ImageTag } from '../../api'
import { buildTagPicker, describeVariant, formatAge, formatSize, loadTags } from './imageTags'

const compact = new Intl.NumberFormat('en', { notation: 'compact' })

function Chip(props: { active: boolean; disabled?: boolean; title?: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`rounded px-1.5 py-0.5 font-mono text-xs ${
        props.active ? 'bg-indigo-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
      }`}
    >
      {props.children}
    </button>
  )
}

/**
 * Docker image field. Typing a name suggests Docker Hub images. Once an image is picked
 * (or a ":" is typed) it becomes a tag builder: version and variant chips plus a
 * searchable tag list, so users don't need to remember exact tag spellings.
 */
export function ImageInput(props: { value: string; onChange: (v: string) => void; placeholder?: string; className: string }) {
  const { value, onChange } = props
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [pickedImage, setPickedImage] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  // Results are tagged with the query they belong to, so stale responses are never shown.
  const [hits, setHits] = useState<{ q: string; items: ImageHit[] } | null>(null)
  const [base, setBase] = useState<{ image: string; tags: ImageTag[] } | null>(null)
  const [found, setFound] = useState<{ key: string; tags: ImageTag[] } | null>(null)

  const colon = value.indexOf(':')
  const image = (colon >= 0 ? value.slice(0, colon) : value).trim()
  const typedTag = colon >= 0 ? value.slice(colon + 1).trim() : ''
  const tagMode = open && image.length > 0 && !value.includes('@') && (colon >= 0 || pickedImage === value)
  const nameMode = open && !tagMode && colon < 0 && image.length >= 2

  useEffect(() => {
    if (!nameMode) return
    let cancelled = false
    const t = setTimeout(() => {
      api.searchImages(image).then(
        (items) => !cancelled && setHits({ q: image, items }),
        () => !cancelled && setHits({ q: image, items: [] }),
      )
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [nameMode, image])

  useEffect(() => {
    if (!tagMode) return
    let cancelled = false
    loadTags(image).then(
      (tags) => !cancelled && setBase({ image, tags }),
      () => !cancelled && setBase({ image, tags: [] }),
    )
    return () => {
      cancelled = true
    }
  }, [tagMode, image])

  // Typed text can name old versions that aren't among the recent tags: search all of them.
  useEffect(() => {
    if (!tagMode || !typedTag) return
    let cancelled = false
    const key = `${image}:${typedTag}`
    const t = setTimeout(() => {
      loadTags(image, typedTag).then((tags) => !cancelled && setFound({ key, tags }), () => {})
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [tagMode, image, typedTag])

  const imageHits = nameMode && hits?.q === image ? hits.items : []
  const baseTags = base?.image === image ? base.tags : null
  const searched = found?.key === `${image}:${typedTag}` ? found.tags : []
  const { tagList, current, versions, variants, hasLatest, tagForVersion, tagForVariant } = buildTagPicker(
    baseTags ?? [],
    searched,
    typedTag,
  )

  const setTag = (tag: string | undefined) => {
    if (!tag) return
    onChange(`${image}:${tag}`)
    setActive(-1)
  }
  const pickImage = (hit: ImageHit) => {
    onChange(hit.name)
    setPickedImage(hit.name) // stay open and switch to choosing a tag
    setActive(-1)
  }
  const pickTag = (t: ImageTag) => {
    onChange(`${image}:${t.name}`)
    setOpen(false)
  }

  const listLength = tagMode ? tagList.length : imageHits.length
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') return setOpen(false)
    if (!listLength) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + listLength) % listLength)
    } else if (e.key === 'Enter' && active >= 0 && active < listLength) {
      e.preventDefault()
      if (tagMode) pickTag(tagList[active])
      else pickImage(imageHits[active])
    }
  }

  const showNames = nameMode && imageHits.length > 0
  const showTags = tagMode && baseTags !== null && (baseTags.length > 0 || tagList.length > 0)
  const loadingTags = tagMode && baseTags === null

  return (
    <div className="relative">
      <input
        value={value}
        placeholder={props.placeholder}
        className={props.className}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setActive(-1)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        role="combobox"
        aria-expanded={showNames || showTags}
        autoComplete="off"
        spellCheck={false}
      />
      {(showNames || showTags || loadingTags) && (
        // preventDefault on mousedown keeps focus in the input, so clicks land before blur closes the list
        <div
          onMouseDown={(e) => e.preventDefault()}
          className="absolute z-20 mt-1 w-full min-w-72 overflow-hidden rounded-lg bg-slate-800 text-sm shadow-xl ring-1 ring-slate-700"
        >
          {showNames && (
            <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
              {imageHits.map((h, i) => (
                <li
                  key={h.name}
                  role="option"
                  aria-selected={i === active}
                  onClick={() => pickImage(h)}
                  onMouseEnter={() => setActive(i)}
                  className={`cursor-pointer px-3 py-1.5 ${i === active ? 'bg-slate-700' : ''}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono">{h.name}</span>
                    {h.official && <span className="rounded bg-sky-900 px-1 text-[10px] text-sky-300">Official</span>}
                    <span className="ml-auto shrink-0 text-xs text-slate-500">{compact.format(h.pulls)} pulls</span>
                  </div>
                  {h.description && <div className="truncate text-xs text-slate-400">{h.description}</div>}
                </li>
              ))}
            </ul>
          )}

          {loadingTags && <p className="px-3 py-2 text-slate-400">Loading tags for {image}…</p>}

          {showTags && (
            <>
              <div className="space-y-2 border-b border-slate-700 p-2">
                {(versions.length > 0 || hasLatest) && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">Version</div>
                    <div className="flex flex-wrap gap-1">
                      {hasLatest && (
                        <Chip active={typedTag === 'latest'} onClick={() => setTag('latest')} title="Moves with every release; avoid in production">
                          latest
                        </Chip>
                      )}
                      {versions.map((v) => (
                        <Chip key={v} active={current?.version === v} onClick={() => setTag(tagForVersion(v))}>
                          {v}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}
                {variants.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      Variant{current?.version ? ` for ${current.version}` : ''}
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {variants.map((v) => (
                        <span key={v || 'default'} onMouseEnter={() => setHint(describeVariant(v))} onMouseLeave={() => setHint(null)}>
                          <Chip active={!!current && current.variant === v} onClick={() => setTag(tagForVariant(v))} title={describeVariant(v)}>
                            {v || 'default'}
                          </Chip>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                <p className="min-h-4 text-xs text-slate-400">
                  {hint ?? (current ? describeVariant(current.variant) : 'Pick a version and variant, or type after the ":" to search tags.')}
                </p>
              </div>
              <ul role="listbox" className="max-h-56 overflow-y-auto py-1">
                {tagList.length === 0 && <li className="px-3 py-1.5 text-slate-500">No tags match "{typedTag}"</li>}
                {tagList.map((t, i) => (
                  <li
                    key={t.name}
                    role="option"
                    aria-selected={i === active}
                    onClick={() => pickTag(t)}
                    onMouseEnter={() => setActive(i)}
                    className={`flex cursor-pointer items-center gap-2 px-3 py-1 ${i === active ? 'bg-slate-700' : ''}`}
                  >
                    <span className="truncate font-mono">
                      <span className="text-slate-500">{image}:</span>
                      {t.name}
                    </span>
                    <span className="ml-auto shrink-0 text-xs text-slate-500">
                      {[formatSize(t.size), formatAge(t.updated)].filter(Boolean).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
