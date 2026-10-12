import { expect, type Page } from '@playwright/test';

/** Unfolds the Simulation bar (it starts folded) unless it is already open. */
export async function openSimulation(page: Page): Promise<void> {
  const fold = page.getByRole('button', { name: /Simulation/ });
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click();
  await expect(fold).toHaveAttribute('aria-expanded', 'true');
}
