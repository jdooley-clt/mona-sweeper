import { readFile } from 'node:fs/promises';
import { test as base, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { Game } from '../src/engine.js';
import { cabinetRoot, cabinetSha, candidateCatalog, origin } from '../scripts/cabinet.mjs';

const candidate = `${origin}/mona-sweeper/`;
const SIBLING_STUB = '<!doctype html><title>Sibling stub</title><p>Sibling game stub</p>';
const EXPECTED_CSP = "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'";

const test = base.extend({
  page: async ({ page }, use) => {
    const failures = [];
    const failed = [];
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', (event) => {
        const summary = `${event.violatedDirective} ${event.blockedURI} ${event.sample || ''}`.trim();
        window.__cspViolations.push(summary);
        console.error(`CSP violation: ${summary}`);
      });
    });
    page.on('pageerror', (error) => failures.push(error.message));
    page.on('console', (message) => { if (message.type() === 'error') failures.push(message.text()); });
    page.on('response', (response) => { if (response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
    page.on('requestfailed', (request) => failed.push(request));
    // Sibling games are isolated so lifecycle tests do not depend on the network.
    await page.route('https://jdooley-clt.github.io/**', (route) => route.fulfill({ contentType: 'text/html', body: SIBLING_STUB }));
    await use(page);
    for (const frame of page.frames()) {
      if (!frame.url().startsWith(origin) || frame.isDetached()) continue;
      const violations = await frame.evaluate(() => window.__cspViolations ?? []).catch(() => []);
      for (const v of violations) failures.push(`CSP violation (${frame.url()}): ${v}`);
    }
    for (const request of failed) {
      const reason = request.failure()?.errorText;
      if (['net::ERR_ABORTED', 'cancelled'].includes(reason)) continue;
      failures.push(`${reason} ${request.url()}`);
    }
    expect(failures, 'No uncaught errors, console errors, CSP violations, or failed requests').toEqual([]);
  },
});

const card = (page) => page.getByRole('button', { name: 'Play Mona Sweeper', exact: true });
const stageData = (frame, key) => frame.locator('#stage').getAttribute(`data-${key}`);

async function readyGame(page) {
  const iframe = page.locator('#frame-host iframe');
  await expect(iframe).toHaveCount(1);
  await expect(iframe).toHaveAttribute('src', candidate);
  await expect.poll(() => page.frames().find((f) => f.url() === candidate)?.url()).toBe(candidate);
  const frame = page.frames().find((f) => f.url() === candidate);
  await expect.poll(() => stageData(frame, 'status'), { timeout: 30_000 }).toBe('ready');
  await expect(frame.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', EXPECTED_CSP);
  await expect(frame.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');
  await expect(frame.locator('#arcade-link')).toBeHidden();
  await expect(frame.locator('#source-link')).toBeHidden();
  await expect(frame.locator('#board [role="row"]')).toHaveCount(9);
  await expect(frame.locator('#board .cell')).toHaveCount(81);
  return frame;
}

async function launchWithSpace(page, frame) {
  const scroll = await page.evaluate(() => scrollY);
  await page.keyboard.press('Space');
  await expect.poll(() => stageData(frame, 'status')).toBe('playing');
  await expect(page.locator('#frame-host iframe')).toBeFocused();
  expect(await page.evaluate(() => scrollY), 'Space does not scroll the cabinet').toBe(scroll);
  expect(await frame.evaluate(() => scrollY), 'Space does not scroll the game document').toBe(0);
  await expect.poll(async () => Number(await stageData(frame, 'revealed'))).toBeGreaterThan(0);
}

test.beforeEach(async ({ page, request }) => {
  expect(await (await request.get('/health')).json()).toEqual({ cabinetSha });
  const served = await request.get(candidate);
  expect(served.ok()).toBeTruthy();
  expect(await served.text()).toBe(await readFile('_site/index.html', 'utf8'));
  await page.goto('/arcade/');
  await expect(card(page)).toBeVisible();
});

test('serves the real pinned cabinet with only the Mona Sweeper entry changed', async ({ request }) => {
  const original = JSON.parse(await readFile(`${cabinetRoot}/games.json`, 'utf8'));
  expect(await (await request.get('/arcade/games.json')).json()).toEqual(candidateCatalog(original));
  for (const file of ['index.html', 'styles.css', 'src/app.js', 'src/catalog.js']) {
    expect(await (await request.get(`/arcade/${file}`)).text()).toBe(await readFile(`${cabinetRoot}/${file}`, 'utf8'));
  }
});

test('standalone footer links are visible and keyboard accessible without controlling the game', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard coverage runs on desktop.');
  await page.goto(candidate);
  await expect.poll(() => stageData(page, 'status'), { timeout: 30_000 }).toBe('ready');
  const link = page.getByRole('link', { name: 'More games in GitHub Arcade', exact: true });
  const sourceLink = page.getByRole('link', { name: 'Source & credits', exact: true });
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', 'https://jdooley-clt.github.io/arcade/');
  expect(await link.getAttribute('target')).toBeNull();
  await expect(sourceLink).toBeVisible();
  await expect(sourceLink).toHaveAttribute('href', 'https://github.com/jdooley-clt/mona-sweeper');
  expect(await sourceLink.getAttribute('target')).toBeNull();
  await page.locator('#primary').click();
  await expect.poll(() => stageData(page, 'status')).toBe('playing');
  await page.locator('#stage').focus();
  const cx = await stageData(page, 'cursor-x');
  for (const target of [link, sourceLink]) {
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
    await page.keyboard.press('ArrowRight');
    expect(await stageData(page, 'cursor-x')).toBe(cx);
    for (const key of ['Space', 'p', 'm', 'f']) await page.keyboard.press(key);
    expect(await stageData(page, 'status')).toBe('playing');
    await expect(page.locator('#music')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#sound')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.keyboard.press('Shift+Tab');
  await expect(link).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL('https://jdooley-clt.github.io/arcade/');
});

for (const launch of ['mouse', 'keyboard']) {
  test(`${launch} launch: Space, arrows, flag, mode toggle, pause and mute reach the game; reload and return clean up`, async ({ page, isMobile }) => {
    test.skip(isMobile, 'Keyboard coverage runs on desktop.');
    if (launch === 'mouse') await card(page).click();
    else { await card(page).focus(); await page.keyboard.press('Enter'); }
    let frame = await readyGame(page);
    await expect(page.locator('#frame-host iframe')).toBeFocused();
    await launchWithSpace(page, frame);

    const cx = Number(await stageData(frame, 'cursor-x'));
    await page.keyboard.press('ArrowLeft');
    await expect.poll(async () => Number(await stageData(frame, 'cursor-x'))).toBe(cx - 1);
    await page.keyboard.press('d');
    await expect.poll(async () => Number(await stageData(frame, 'cursor-x'))).toBe(cx);

    // Move to corner (0,0) or find an unrevealed cell via DOM and flag it with F
    const unrevealedCoords = await frame.evaluate(() => {
      const el = document.querySelector('.cell[data-state="hidden"]');
      return { x: Number(el.dataset.x), y: Number(el.dataset.y) };
    });
    await frame.locator(`.cell[data-x="${unrevealedCoords.x}"][data-y="${unrevealedCoords.y}"]`).click({ button: 'right' });
    await expect.poll(() => stageData(frame, 'flags')).toBe('1');
    await page.keyboard.press('f');
    await expect.poll(() => stageData(frame, 'flags')).toBe('0');

    await page.keyboard.press('x');
    await expect.poll(() => stageData(frame, 'mode')).toBe('flag');
    await page.keyboard.press('x');
    await expect.poll(() => stageData(frame, 'mode')).toBe('reveal');

    for (const key of ['p', 'Escape']) {
      await page.keyboard.press(key);
      await expect.poll(() => stageData(frame, 'status')).toBe('paused');
      const t = await stageData(frame, 'elapsed');
      await page.waitForTimeout(200);
      expect(await stageData(frame, 'elapsed')).toBe(t);
      await expect(frame.locator('#message')).toBeVisible();
      await page.keyboard.press(key === 'p' ? 'p' : 'Space');
      await expect.poll(() => stageData(frame, 'status')).toBe('playing');
    }

    await page.keyboard.press('m');
    await expect(frame.locator('#music')).toHaveAttribute('aria-pressed', 'false');
    await expect(frame.locator('#sound')).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('m');
    await expect(frame.locator('#music')).toHaveAttribute('aria-pressed', 'true');

    await page.locator('#reload-game').click();
    await expect.poll(() => frame.isDetached()).toBe(true);
    frame = await readyGame(page);
    await launchWithSpace(page, frame);
    await page.locator('#return-button').click();
    await expect(page.locator('iframe')).toHaveCount(0);
    await expect(card(page)).toBeFocused();
    expect(frame.isDetached()).toBe(true);
  });
}

test('in-game buttons keep Space for the game, switch difficulties, and toggle settings', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Keyboard coverage runs on desktop.');
  await card(page).click();
  const frame = await readyGame(page);
  await frame.locator('#theme').click();
  await expect(frame.locator('html')).toHaveAttribute('data-theme', /dark|light/);
  const theme = await frame.locator('html').getAttribute('data-theme');
  await frame.locator('#sound').focus();
  await page.keyboard.press('Space');
  await expect.poll(() => stageData(frame, 'status')).toBe('playing');
  await expect(frame.locator('#sound'), 'Space did not activate the focused button').toHaveAttribute('aria-pressed', 'true');
  await frame.locator('#theme').click();
  await expect(frame.locator('html')).not.toHaveAttribute('data-theme', theme);

  await frame.locator('#diff-active').click();
  await expect.poll(() => stageData(frame, 'difficulty')).toBe('active');
  await expect(frame.locator('#board .cell')).toHaveCount(144);

  await frame.locator('#diff-monorepo').click();
  await expect.poll(() => stageData(frame, 'difficulty')).toBe('monorepo');
  await expect(frame.locator('#board .cell')).toHaveCount(168);

  await frame.locator('#diff-starter').click();
  await expect.poll(() => stageData(frame, 'difficulty')).toBe('starter');
  await expect(frame.locator('#board .cell')).toHaveCount(81);

  await frame.locator('#help').click();
  await expect(frame.locator('#help-dialog')).toBeVisible();
  await expect.poll(() => stageData(frame, 'status')).toBe('paused');
  await frame.locator('#close-help').click();
  await expect(frame.locator('#help-dialog')).toBeHidden();
  await expect.poll(() => stageData(frame, 'status')).toBe('playing');
  await frame.locator('#help').click();
  await page.keyboard.press('Escape');
  await expect(frame.locator('#help-dialog')).toBeHidden();
  await expect.poll(() => stageData(frame, 'status')).toBe('playing');
});

test('switching to another game detaches the Mona Sweeper frame', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Lifecycle coverage runs on desktop.');
  await card(page).click();
  const frame = await readyGame(page);
  await launchWithSpace(page, frame);
  await page.goto('/arcade/#game/mona-maze');
  await expect(page.locator('#frame-host iframe')).toHaveCount(1);
  await expect(page.locator('#frame-host iframe')).toHaveAttribute('src', 'https://jdooley-clt.github.io/mona-maze/');
  await expect.poll(() => frame.isDetached()).toBe(true);
  await page.goBack();
  await expect(page.locator('#frame-host iframe')).toHaveAttribute('src', candidate);
});

for (const width of [320, 390]) {
  test(`touch at ${width}px: no overflow, tap reveals, Flag mode toggle plants flags, controls reachable`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Touch coverage runs on the mobile project.');
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/arcade/#game/mona-sweeper');
    const frame = await readyGame(page);
    for (const doc of [page, frame]) {
      const overflow = await doc.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      expect(overflow, 'No horizontal overflow').toBeLessThanOrEqual(0);
    }

    await frame.locator('#primary').tap();
    await expect.poll(() => stageData(frame, 'status')).toBe('playing');
    await expect.poll(async () => Number(await stageData(frame, 'revealed'))).toBeGreaterThan(0);

    await frame.locator('#mode-toggle').tap();
    await expect.poll(() => stageData(frame, 'mode')).toBe('flag');

    const hiddenCell = frame.locator('.cell[data-state="hidden"]').first();
    await hiddenCell.scrollIntoViewIfNeeded();
    await hiddenCell.tap();
    await expect.poll(() => stageData(frame, 'flags')).toBe('1');

    await frame.locator('#mode-toggle').tap();
    await expect.poll(() => stageData(frame, 'mode')).toBe('reveal');

    for (const id of ['theme', 'music', 'sound', 'help', 'diff-starter', 'diff-active', 'diff-monorepo', 'mode-toggle', 'flag-here', 'new-game', 'pause', 'percentage']) {
      const control = frame.locator(`#${id}`);
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeInViewport();
      const r = await control.evaluate((el) => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right }; });
      expect(r.left).toBeGreaterThanOrEqual(0);
      expect(r.right).toBeLessThanOrEqual(width + 1);
    }
    await frame.locator('#pause').tap();
    await expect.poll(() => stageData(frame, 'status')).toBe('paused');
    expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), `mobile ${width}px axe`).toEqual([]);
  });
}

test('reduced motion still plays', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Runs once on desktop.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card(page).click();
  const frame = await readyGame(page);
  await launchWithSpace(page, frame);
});

test('enforces strict CSP and referrer policy with zero violations across difficulties and gameplay', async ({ page }) => {
  await page.goto(candidate);
  await expect.poll(() => stageData(page, 'status'), { timeout: 30_000 }).toBe('ready');
  await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveAttribute('content', EXPECTED_CSP);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'strict-origin-when-cross-origin');
  await expect(page.locator('script:not([src])')).toHaveCount(0);
  const badBlankLinks = await page.evaluate(() => (
    [...document.querySelectorAll('a[target="_blank"]')].filter((a) => {
      const rel = (a.getAttribute('rel') || '').split(/\s+/);
      return !rel.includes('noopener') || !rel.includes('noreferrer');
    }).length
  ));
  expect(badBlankLinks).toBe(0);

  await page.locator('#primary').click();
  await expect.poll(() => stageData(page, 'status')).toBe('playing');
  for (const [btnId, cols, rows] of [['diff-active', '12', '12'], ['diff-monorepo', '14', '12'], ['diff-starter', '9', '9']]) {
    await page.locator(`#${btnId}`).click();
    await expect(page.locator('#board')).toHaveAttribute('data-cols', cols);
    await expect(page.locator('#board')).toHaveAttribute('data-rows', rows);
  }
  await expect(page.locator('[style]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
});

async function seriousOrCriticalViolations(page, frameSelector = null) {
  let builder = new AxeBuilder({ page }).options({
    rules: { 'label-content-name-mismatch': { enabled: true } },
  });
  if (frameSelector) builder = builder.include(frameSelector);
  const { violations } = await builder.analyze();
  return violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact, targets: v.nodes.map((n) => n.target) }));
}

async function driveDeterministicLoss(doc) {
  await doc.locator('#primary').click();
  await expect.poll(() => stageData(doc, 'status')).toBe('playing');
  const sim = new Game({ seed: 1, difficulty: 'starter' });
  sim.reveal(4, 4);
  const safe = sim.cells.find((c) => !c.revealed && !c.bug);
  const bug = sim.cells.find((c) => !c.revealed && c.bug);
  await doc.locator(`.cell[data-x="${safe.x}"][data-y="${safe.y}"]`).click({ button: 'right' });
  await doc.locator(`.cell[data-x="${bug.x}"][data-y="${bug.y}"]`).click();
  await expect.poll(() => stageData(doc, 'status')).toBe('over');
}

async function driveDeterministicWin(doc) {
  await doc.locator('#primary').click();
  await expect.poll(() => stageData(doc, 'status')).toBe('playing');
  const sim = new Game({ seed: 1, difficulty: 'starter' });
  sim.reveal(4, 4);
  const coords = [];
  for (const cell of sim.cells) {
    if (cell.bug || cell.revealed) continue;
    coords.push([cell.x, cell.y]);
    sim.reveal(cell.x, cell.y);
  }
  await doc.evaluate((targets) => {
    for (const [x, y] of targets) {
      document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`)?.click();
    }
  }, coords);
  await expect.poll(() => stageData(doc, 'status')).toBe('won');
}

async function loadSeededCabinetFrame(page, run) {
  const url = `${candidate}?seed=1&run=${run}`;
  await page.locator('#frame-host iframe').evaluate((el, nextUrl) => { el.src = nextUrl; }, url);
  await expect.poll(() => page.frames().find((f) => f.url() === url)?.url()).toBe(url);
  const frame = page.frames().find((f) => f.url() === url);
  await expect.poll(() => stageData(frame, 'status'), { timeout: 30_000 }).toBe('ready');
  return frame;
}

test('standalone axe accessibility gate passes across ready, playing, paused, help dialog, win, and loss states and catches injected violations', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Comprehensive state-by-state axe gate runs on desktop; touch states are gated in mobile tests.');

  for (const theme of ['light', 'dark']) {
    await page.goto(`${candidate}?seed=1`);
    await expect.poll(() => stageData(page, 'status'), { timeout: 30_000 }).toBe('ready');
    if ((await page.locator('html').getAttribute('data-theme')) !== theme) {
      await page.locator('#theme').click();
    }
    expect(await seriousOrCriticalViolations(page), `standalone ready (${theme})`).toEqual([]);

    await page.locator('#primary').click();
    await expect.poll(() => stageData(page, 'status')).toBe('playing');
    await page.locator('.cell[data-state="hidden"]').first().click({ button: 'right' });
    expect(await seriousOrCriticalViolations(page), `standalone playing (${theme})`).toEqual([]);

    await page.locator('#pause').click();
    await expect.poll(() => stageData(page, 'status')).toBe('paused');
    expect(await seriousOrCriticalViolations(page), `standalone paused (${theme})`).toEqual([]);
    await page.locator('#pause').click();

    await page.locator('#help').click();
    await expect(page.locator('#help-dialog')).toBeVisible();
    expect(await seriousOrCriticalViolations(page), `standalone help dialog (${theme})`).toEqual([]);
    await page.locator('#close-help').click();

    await page.goto(`${candidate}?seed=1`);
    await expect.poll(() => stageData(page, 'status')).toBe('ready');
    await driveDeterministicLoss(page);
    expect(await seriousOrCriticalViolations(page), `standalone loss (${theme})`).toEqual([]);

    await page.goto(`${candidate}?seed=1`);
    await expect.poll(() => stageData(page, 'status')).toBe('ready');
    await driveDeterministicWin(page);
    expect(await seriousOrCriticalViolations(page), `standalone win (${theme})`).toEqual([]);
  }

  // Sanity check: an injected unlabeled button must be caught as serious/critical.
  await page.evaluate(() => {
    const probe = document.createElement('button');
    probe.id = 'axe-sanity-probe';
    probe.type = 'button';
    document.body.append(probe);
  });
  const injected = await seriousOrCriticalViolations(page);
  expect(injected.some((v) => v.id === 'button-name')).toBe(true);
  await page.evaluate(() => document.getElementById('axe-sanity-probe')?.remove());
  expect(await seriousOrCriticalViolations(page)).toEqual([]);
});

test('cabinet axe accessibility gate passes across ready, playing, paused, help dialog, win, and loss states', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Comprehensive state-by-state axe gate runs on desktop; touch states are gated in mobile tests.');

  await card(page).click();
  await readyGame(page);
  expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), 'cabinet ready').toEqual([]);

  let frame = await loadSeededCabinetFrame(page, 1);
  await frame.locator('#primary').click();
  await expect.poll(() => stageData(frame, 'status')).toBe('playing');
  expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), 'cabinet playing').toEqual([]);

  await frame.locator('#pause').click();
  await expect.poll(() => stageData(frame, 'status')).toBe('paused');
  expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), 'cabinet paused').toEqual([]);
  await frame.locator('#pause').click();

  await frame.locator('#help').click();
  await expect(frame.locator('#help-dialog')).toBeVisible();
  expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), 'cabinet help dialog').toEqual([]);
  await frame.locator('#close-help').click();

  frame = await loadSeededCabinetFrame(page, 2);
  await driveDeterministicLoss(frame);
  expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), 'cabinet loss').toEqual([]);

  frame = await loadSeededCabinetFrame(page, 3);
  await driveDeterministicWin(frame);
  expect(await seriousOrCriticalViolations(page, '#frame-host iframe'), 'cabinet win').toEqual([]);
});

