import { expect, test } from '@playwright/test'

test('register, land on Connections, sign out and back in', async ({ page }) => {
  const email = `ada+${Date.now()}@example.com`
  await page.goto('/')
  await page.getByRole('tab', { name: 'Create account' }).click()
  await page.getByLabel('Name').fill('Ada Lovelace')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('analytical-engine')
  await page.getByRole('button', { name: 'Create account' }).last().click()

  // onboarding: GitHub not connected yet, repo step disabled until it is
  await expect(page).toHaveURL('/welcome')
  await expect(page.getByRole('heading', { name: 'Connect your GitHub account' })).toBeVisible()
  await expect(page.locator('section').getByRole('link', { name: 'Connect GitHub', exact: true })).toHaveAttribute(
    'href',
    '/api/auth/github/connect?next=/welcome',
  )
  await expect(page.getByText('Ada Lovelace')).toBeVisible()
  await page.getByRole('link', { name: 'Skip for now →' }).click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
  await expect(page.getByText('Connect GitHub to analyze your repositories')).toBeVisible()

  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('tab', { name: 'Sign in' })).toBeVisible()

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill('wrong-password')
  await page.getByRole('button', { name: 'Sign in' }).last().click()
  await expect(page.getByRole('alert')).toHaveText('Incorrect email or password.')

  await page.getByLabel('Password').fill('analytical-engine')
  await page.getByRole('button', { name: 'Sign in' }).last().click()
  await expect(page.getByRole('heading', { name: 'Projects', exact: true })).toBeVisible()
})

test('duplicate email and GitHub errors are explained', async ({ page }) => {
  const email = `dup+${Date.now()}@example.com`
  for (const attempt of [1, 2]) {
    await page.goto('/')
    await page.getByRole('tab', { name: 'Create account' }).click()
    await page.getByLabel('Name').fill('Dup')
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill('password-123')
    await page.getByRole('button', { name: 'Create account' }).last().click()
    if (attempt === 1) {
      await expect(page).toHaveURL('/welcome')
      await page.getByRole('button', { name: 'Sign out' }).click()
    }
  }
  await expect(page.getByRole('alert')).toContainText('already exists')

  await page.goto('/?error=github_denied')
  await expect(page.getByRole('alert')).toHaveText('GitHub authorization was cancelled.')
})
