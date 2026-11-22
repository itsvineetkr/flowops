import { describe, expect, it } from 'vitest'
import type { ImageTag } from '../../api'
import { buildTagPicker, compareVersionsDesc, describeVariant } from './imageTags'

const tag = (name: string, version: string, variant: string, extra: Partial<ImageTag> = {}): ImageTag => ({
  name, version, variant, prerelease: false, windows: false, size: 0, updated: '', ...extra,
})
const python = [
  tag('latest', '', ''), tag('slim', '', 'slim'), tag('3.12', '3.12', ''), tag('3.12-slim', '3.12', 'slim'),
  tag('3.12.15-slim', '3.12.15', 'slim'), tag('3.11', '3.11', ''), tag('3.11-slim', '3.11', 'slim'),
  tag('3.11-alpine', '3.11', 'alpine'), tag('3.16.0a1', '3.16.0a1', '', { prerelease: true }),
  tag('3.12-windowsservercore', '3.12', 'windowsservercore', { windows: true }),
]
const node = ['26', '26.1', '24', '24.9', '22'].map((v) => tag(v, v, ''))

describe('tag picker', () => {
  it('offers minor versions for single-major images and majors otherwise', () => {
    expect(buildTagPicker(python, [], '').versions).toEqual(['3.12', '3.11'])
    expect(buildTagPicker(node, [], '').versions).toEqual(['26', '24', '22'])
  })

  it('shows variants that exist for the current version, keeping variant across versions', () => {
    const p = buildTagPicker(python, [], '3.12-slim')
    expect(p.current?.version).toBe('3.12')
    expect(p.variants).toEqual(['', 'slim']) // windows hidden
    expect(p.tagForVersion('3.11')).toBe('3.11-slim')
    expect(buildTagPicker(python, [], '3.12').tagForVariant('alpine')).toBeUndefined() // 3.12-alpine doesn't exist
  })

  it('ranks the typed version before patch releases and hides prereleases/windows', () => {
    const names = buildTagPicker(python, [], '3.1').tagList.map((t) => t.name)
    expect(names).not.toContain('3.16.0a1')
    expect(names).not.toContain('3.12-windowsservercore')
    expect(buildTagPicker(python, [], '3.12').tagList.map((t) => t.name).slice(0, 2)).toEqual(['3.12', '3.12-slim'])
    expect(buildTagPicker(python, [], 'windows').tagList.map((t) => t.name)).toEqual(['3.12-windowsservercore'])
  })

  it('uses full-search results for old versions', () => {
    const old = [tag('3.8', '3.8', ''), tag('3.8-slim', '3.8', 'slim')]
    const p = buildTagPicker(python, old, '3.8')
    expect(p.current?.name).toBe('3.8')
    expect(p.tagForVariant('slim')).toBe('3.8-slim')
  })
})

describe('helpers', () => {
  it('compares versions numerically', () => {
    expect(['3.9', '3.15', '3'].sort(compareVersionsDesc)).toEqual(['3.15', '3.9', '3'])
  })
  it('describes variants', () => {
    expect(describeVariant('slim-bookworm')).toMatch(/Minimal Debian 12/)
    expect(describeVariant('alpine3.20')).toMatch(/Alpine Linux 3.20/)
  })
})
