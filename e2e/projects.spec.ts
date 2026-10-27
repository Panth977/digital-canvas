import { expect, test, type Page } from '@playwright/test';
import { doc, elements, newDesign, pngBytes } from './helpers.ts';
import { screenOf } from './module-stubs.ts';

/** A saved design with a photo in it; returns its id and the photo's asset id. */
async function designWithPhoto(page: Page, title: string): Promise<{ id: string; asset: string }> {
  await newDesign(page);
  const png = await pngBytes(page, 64, 48, '#22aa66');
  await page.evaluate(async ([b64, t]) => {
    const ed = (window as any).__dc;
    const bytes = Uint8Array.from(atob(b64 as string), (c) => c.charCodeAt(0));
    await ed.addPhoto(bytes, 'image/png', 'green.png');
    ed.rename(t);
    await ed.save();
  }, [png.toString('base64'), title]);
  const d = await doc(page);
  return { id: d.id, asset: d.pages[0].elements[0].asset };
}

test('projects: browse designs, reuse pages, open another design here', async ({ page }) => {
  const old = await designWithPhoto(page, 'Summer flyer');
  await newDesign(page);
  const cur = (await doc(page)).id;
  await page.getByTestId('tab-projects').click();
  await expect(page.getByTestId('projects-panel')).toBeVisible();
  await expect(page.getByTestId(`project-${old.id}`)).toContainText('Summer flyer');
  await expect(page.getByTestId(`project-${cur}`)).toContainText('Open now');
  await page.getByTestId('projects-search').fill('summer');
  await expect(page.getByTestId('projects-designs').locator('[data-testid^="project-d"]')).toHaveCount(1);

  // copy its page in (blank page: replaced directly)
  await page.getByTestId(`project-${old.id}`).hover();
  await page.getByTestId(`project-use-${old.id}`).click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  const d = await doc(page);
  expect(d.pages[0].elements[0].asset).toBe(old.asset);
  expect(d.assets[old.asset].mime).toBe('image/png');

  // open it in the same tab
  await page.getByTestId(`project-${old.id}`).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/d/${old.id}`);
  await page.waitForFunction((id) => (window as any).__dc?.doc.id === id, old.id);

  // folders list where designs live
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('projects-tab-folders').click();
  await expect(page.getByTestId('projects-folder-main')).toContainText('This browser');
  await page.getByTestId('projects-folder-main').click();
  await expect(page.getByTestId(`project-${cur}`)).toBeVisible();
});

test('projects: images from other designs, by click or drag', async ({ page }) => {
  const old = await designWithPhoto(page, 'Photo design');
  await newDesign(page);
  await page.getByTestId('tab-projects').click();
  await page.getByTestId('projects-tab-images').click();
  const item = page.getByTestId('projects-media-item');
  await expect(item).toHaveCount(1);
  await item.click();
  await expect.poll(async () => (await elements(page)).length).toBe(1);
  expect(((await elements(page))[0] as any).asset).toBe(old.asset);

  // drag it onto the page
  const target = await screenOf(page, { x: 800, y: 800 });
  await item.dragTo(page.getByTestId('stage'), { targetPosition: { x: target.x - (await page.getByTestId('stage').boundingBox())!.x, y: target.y - (await page.getByTestId('stage').boundingBox())!.y } });
  await expect.poll(async () => (await elements(page)).length).toBe(2);
  const dropped = (await elements(page))[1] as any;
  expect(dropped.asset).toBe(old.asset);
  expect(dropped.x + dropped.w / 2).toBeGreaterThan(600);

  await page.getByTestId('projects-tab-videos').click();
  await expect(page.getByText('No videos in your designs yet.')).toBeVisible();
});
