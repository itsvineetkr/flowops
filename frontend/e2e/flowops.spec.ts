import { expect, previewText, test } from './fixtures'

test('warns on empty project name, then creates a project from a template', async ({ loggedIn: page }) => {
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a project name')
  await expect(page).toHaveURL('/')

  await page.getByPlaceholder('New project name').fill('Payments API')
  await expect(page.getByRole('alert')).toBeHidden()
  await page.getByRole('button', { name: /Python \+ FastAPI/ }).click()
  await page.getByRole('button', { name: 'Create' }).click()

  await expect(page).toHaveURL(/\/p\/\d+$/)
  await expect(page.locator('.react-flow__node')).toHaveCount(7) // FastAPI pipeline template
  await expect.poll(() => previewText(page)).toContain('actions/setup-python@v5')

  await page.getByRole('button', { name: 'Dockerfile', exact: true }).click()
  await expect.poll(() => previewText(page)).toContain('FROM python:3.12-slim')
})

test('builds a Dockerfile with drag-and-drop, image search, undo and autosave', async ({ loggedIn: page }) => {
  await page.getByPlaceholder('New project name').fill('Scratch')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/p\/\d+$/)
  await page.getByRole('button', { name: 'Dockerfile', exact: true }).click()

  // drag FROM from the palette onto the canvas
  await page.getByRole('button', { name: 'FROM', exact: true }).dragTo(page.locator('.react-flow__pane'))
  await expect(page.locator('.react-flow__node')).toHaveCount(1)

  // image search: name -> tag builder chips
  const image = page.getByRole('combobox')
  await image.fill('pyt')
  await page.getByRole('option', { name: /^python/ }).click()
  await page.getByRole('button', { name: '3.12', exact: true }).click()
  await page.getByRole('button', { name: 'slim', exact: true }).click()
  await expect(image).toHaveValue('python:3.12-slim')
  await expect.poll(() => previewText(page)).toContain('FROM python:3.12-slim')

  // click-to-add a RUN step, then undo it
  await page.getByRole('button', { name: 'RUN', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)
  await page.getByRole('button', { name: /Undo/ }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(1)
  await page.getByRole('button', { name: /Redo/ }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)

  // autosave survives a reload
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.waitForTimeout(1200) // > autosave debounce
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'Dockerfile', exact: true }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(2)

  // export downloads a .flowops.json
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export' }).click()
  expect((await download).suggestedFilename()).toBe('scratch-dockerfile.flowops.json')
})

test('import rejects a bad file and loads a good one', async ({ loggedIn: page }) => {
  await page.getByPlaceholder('New project name').fill('Imports')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/p\/\d+$/)

  const input = page.locator('input[type=file]')
  await input.setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"nope":1}') })
  await expect(page.getByText(/Import failed: Not a Flow Ops export/)).toBeVisible()

  const flow = {
    flowops: 1,
    kind: 'compose',
    graph: { nodes: [{ id: 'db', type: 'service', params: { name: 'db', image: 'postgres:16' } }], edges: [] },
  }
  await input.setInputFiles({ name: 'ok.flowops.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(flow)) })
  await expect(page.getByRole('button', { name: 'Compose', exact: true })).toHaveClass(/bg-slate-700/) // switched tab
  await expect.poll(() => previewText(page)).toContain('image: postgres:16')
})

/** Asserts the flow's bounding box is centered in the visible canvas and fully on screen. */
async function expectCentered(page: import('@playwright/test').Page) {
  await expect
    .poll(async () => {
      const pane = (await page.locator('.react-flow').boundingBox())!
      const boxes = await page.locator('.react-flow__node').evaluateAll((els) =>
        els.map((el) => el.getBoundingClientRect()).map((r) => ({ l: r.left, r: r.right, t: r.top, b: r.bottom })),
      )
      const l = Math.min(...boxes.map((b) => b.l))
      const r = Math.max(...boxes.map((b) => b.r))
      const t = Math.min(...boxes.map((b) => b.t))
      const b = Math.max(...boxes.map((b) => b.b))
      const inside = l >= pane.x && r <= pane.x + pane.width && t >= pane.y && b <= pane.y + pane.height
      const dx = Math.abs((l + r) / 2 - (pane.x + pane.width / 2))
      const dy = Math.abs((t + b) / 2 - (pane.y + pane.height / 2))
      return inside && dx < pane.width * 0.05 && dy < pane.height * 0.05
    })
    .toBe(true)
}

test('flow opens centered, including after restored pane sizes, tab switch and resize', async ({ loggedIn: page }) => {
  await page.getByPlaceholder('New project name').fill('Centered')
  await page.getByRole('button', { name: /Python \+ FastAPI/ }).click()
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await expectCentered(page)

  // drag the palette divider: pane sizes are saved and restored on the next visit (the original bug)
  const handle = page.locator('[data-panel-resize-handle-id]').first()
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + 200)
  await page.mouse.down()
  await page.mouse.move(box.x + 250, box.y + 200, { steps: 8 })
  await page.mouse.up()
  await expectCentered(page) // re-fits while resizing

  await page.reload()
  await expect(page.locator('.react-flow__node')).toHaveCount(7)
  await expectCentered(page)

  await page.getByRole('button', { name: 'Dockerfile', exact: true }).click()
  await expectCentered(page)
})

test('connects using the generous port hit area and snaps nearby drags', async ({ loggedIn: page }) => {
  await page.getByPlaceholder('New project name').fill('Connections')
  await page.getByRole('button', { name: 'Create' }).click()
  await expect(page).toHaveURL(/\/p\/\d+$/)
  await page.locator('input[type=file]').setInputFiles({
    name: 'connections.flowops.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({
      flowops: 1, kind: 'dockerfile', graph: {
        nodes: [
          { id: 'base', type: 'from', params: { image: 'node:22' }, position: { x: 0, y: 0 } },
          { id: 'run', type: 'run', params: { command: 'npm ci' }, position: { x: 0, y: 220 } },
        ], edges: [],
      },
    })),
  })
  const output = page.locator('[data-id="base"] .source')
  const input = page.locator('[data-id="run"] .target')
  await expect(output).toBeVisible()
  // Click in the transparent surround, outside the visible center dot.
  await output.click({ position: { x: 3, y: 16 } })
  await input.click({ position: { x: 3, y: 16 } })
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  await page.getByRole('button', { name: /Undo/ }).click()
  await expect(page.locator('.react-flow__edge')).toHaveCount(0)
  const from = (await output.boundingBox())!
  const to = (await input.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  // Release beyond the handle itself but inside the magnetic connection radius.
  await page.mouse.move(to.x + to.width / 2 + 28, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.react-flow__edge')).toHaveCount(1)
})

test('project boxes align and logo opens the signed-in landing page', async ({ loggedIn: page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  const sidebar = page.getByRole('complementary', { name: 'Your projects' })
  const form = page.locator('form').filter({ has: page.getByPlaceholder('New project name') })
  const sidebarBox = (await sidebar.boundingBox())!
  const formBox = (await form.boundingBox())!
  expect(Math.abs(sidebarBox.y - formBox.y)).toBeLessThan(2)
  expect(sidebarBox.x).toBeGreaterThan(formBox.x)
  await page.setViewportSize({ width: 390, height: 844 })
  expect((await sidebar.boundingBox())!.y).toBeLessThan((await form.boundingBox())!.y)
  await page.getByRole('link', { name: 'Flow Ops', exact: true }).click()
  await expect(page).toHaveURL('/landing')
  await expect(page.getByText('You’re signed in')).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Sign in' })).toHaveCount(0)
  await page.reload()
  await expect(page.getByText('You’re signed in')).toBeVisible()
  await page.getByRole('link', { name: 'Go to your projects' }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await page.getByRole('link', { name: 'Flow Ops', exact: true }).click()
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible()
})
