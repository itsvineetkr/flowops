import { expect, test as base, type Page } from '@playwright/test'

const tag = (name: string, version: string, variant: string) => ({
  name, version, variant, prerelease: false, windows: false, size: 45_000_000, updated: new Date().toISOString(),
})

/** Docker Hub is stubbed so tests are deterministic and offline-safe. */
async function stubDockerHub(page: Page) {
  await page.route('**/api/dockerhub/search**', (route) =>
    route.fulfill({
      json: [
        { name: 'python', description: 'Python is an interpreted language', official: true, stars: 1, pulls: 9_000_000_000 },
        { name: 'pypy', description: 'PyPy', official: true, stars: 1, pulls: 1_000 },
      ],
    }),
  )
  await page.route('**/api/dockerhub/tags**', (route) =>
    route.fulfill({
      json: [
        tag('latest', '', ''), tag('slim', '', 'slim'),
        tag('3.13', '3.13', ''), tag('3.13-slim', '3.13', 'slim'),
        tag('3.12', '3.12', ''), tag('3.12-slim', '3.12', 'slim'), tag('3.12-alpine', '3.12', 'alpine'),
      ],
    }),
  )
}

export const test = base.extend<{ loggedIn: Page }>({
  // Playwright's fixture callback; named `provide` so the React hooks lint rule doesn't mistake it for use()
  loggedIn: async ({ page }, provide) => {
    await stubDockerHub(page)
    await page.goto('/')
    await page.getByRole('button', { name: 'Dev login' }).click()
    await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
    await provide(page)
  },
})

export { expect }

/** Text of the Monaco preview (Monaco renders spaces as nbsp). */
export async function previewText(page: Page) {
  return ((await page.locator('.monaco-editor .view-lines').first().textContent()) ?? '').replace(/\u00a0/g, ' ')
}
