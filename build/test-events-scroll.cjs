// Local fixture only. Native macOS trackpad rubber-banding needs a separate Safari check.
// NODE_PATH=/tmp/ca-wkw2-tools/node_modules node build/test-events-scroll.cjs
const assert = require('node:assert/strict');
const { chromium, webkit } = require('playwright');
const { expect } = require('playwright/test');
const { harness, event, fixturePassword, serve } = require('./test-teacher-accounts.cjs');
const out = process.env.SCROLL_TEST_OUTPUT || '/tmp/ca-events-scroll';
require('node:fs').mkdirSync(out, { recursive: true });
async function flow(browser, engine, viewport, server) {
  const context = await browser.newContext({ viewport });
  const p = await context.newPage(), errors = [];
  p.on('pageerror', e => errors.push(e.message));
  p.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status()); });
  try {
    await p.goto(server.url);
    await expect(p.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    assert.deepEqual(errors, [], 'sign-in smoke probe');
    await p.screenshot({ path: `${out}/${engine}-${viewport.width}-signin.png` });
    await p.getByRole('textbox', { name: 'Account', exact: true }).fill('Event Lead');
    await p.locator('#pw').fill(fixturePassword);
    await p.getByRole('button', { name: 'Sign In', exact: true }).click();
    await p.getByRole('button', { name: /Fixture Chair/ }).click();
    await expect(p.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    const search = p.getByRole('textbox', { name: 'Search events', exact: true });
    const plus = p.getByRole('button', { name: 'New Event', exact: true });
    const account = p.getByRole('button', { name: 'Account', exact: true });
    const controls = async () => Promise.all([search, plus, account].map(x => x.boundingBox()));
    const fixed = await controls();
    await p.screenshot({ path: `${out}/${engine}-${viewport.width}-top.png` });
    await p.mouse.move(viewport.width / 2, viewport.height / 2);
    await p.mouse.wheel(0, 650);
    await expect.poll(() => p.evaluate(() => document.getElementById('app').scrollTop)).toBeGreaterThan(100);
    assert.equal(await p.evaluate(() => window.scrollY), 0, 'Events moves inside the viewport, not the document');
    const y = await p.evaluate(() => document.getElementById('app').scrollTop);
    assert.deepEqual(await controls(), fixed, 'normal scroll leaves all controls fixed');
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('app')).overscrollBehaviorY), 'contain', 'keep native local bounce, stop chaining');
    await p.screenshot({ path: `${out}/${engine}-${viewport.width}-scrolled.png` });
    const target = await p.locator('#app button[data-a^="open:"]').evaluateAll(bs => bs.find(b => { const r = b.getBoundingClientRect(); return r.top > 100 && r.bottom < innerHeight - 120; })?.dataset.a);
    assert.ok(target, 'a visible event can be opened');
    await p.locator(`[data-a="${target}"]`).click();
    await expect(p.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
    assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).overflowY === 'hidden'), false, 'event details keeps document scrolling');
    await p.mouse.move(viewport.width / 2, viewport.height / 2);
    await p.mouse.wheel(0, 500);
    await expect.poll(() => p.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await p.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(() => p.evaluate(() => document.getElementById('app').scrollTop)).toBe(y);
    await search.fill('Fixture Event 59');
    await expect(p.locator('#app button[data-a^="open:"]')).toHaveCount(1);
    assert.equal(await search.evaluate(e => document.activeElement === e), true, 'search keeps keyboard focus');
    const contentHeight = await p.locator('#app .page').evaluate(e => e.offsetHeight - parseFloat(getComputedStyle(e).paddingBottom));
    await p.setViewportSize({ width: viewport.width, height: Math.ceil(contentHeight + 100) });
    await expect.poll(() => p.evaluate(() => { const e = document.getElementById('app'); return e.scrollHeight - e.clientHeight; })).toBe(0);
    await p.setViewportSize(viewport);
    await search.fill('no such event');
    await expect(p.getByText('No results', { exact: true })).toBeVisible();
    await search.fill('');
    await expect(p.locator('#app button[data-a^="open:"]')).toHaveCount(60);
    await p.evaluate(() => document.getElementById('app').scrollTop = 1e6);
    const last = await p.locator('#app button[data-a^="open:"]').last().boundingBox();
    assert.ok(last.y + last.height <= (await search.boundingBox()).y, 'last event is clear of the bottom controls');
    assert.deepEqual(await controls(), fixed, 'bottom of list keeps controls fixed');
    // wheel is not a physical macOS trackpad gesture and cannot certify rubber-banding.
    await p.mouse.wheel(0, 1500);
    assert.deepEqual(await controls(), fixed, 'boundary wheel does not move controls');
    await plus.click();
    await expect(p.getByRole('heading', { name: 'New Event', exact: true })).toBeVisible();
    await p.getByRole('button', { name: 'Cancel', exact: true }).click();
    await search.focus();
    await p.setViewportSize({ width: viewport.width, height: Math.max(400, viewport.height - 240) });
    await expect(search).toBeInViewport();
    await expect(plus).toBeInViewport();
    assert.equal(await p.evaluate(() => window.scrollY), 0, 'resizing while search is focused keeps the document still');
    await account.click();
    await p.getByRole('button', { name: 'Sign Out', exact: true }).click();
    await p.getByRole('textbox', { name: 'Account', exact: true }).fill('Event Lead');
    await p.locator('#pw').fill(fixturePassword);
    await p.getByRole('button', { name: 'Sign In', exact: true }).click();
    await p.getByRole('button', { name: /Fixture Chair/ }).click();
    await expect.poll(() => p.evaluate(() => document.getElementById('app').scrollTop)).toBe(0);
    assert.deepEqual(errors, [], 'clean console and HTTP probe');
    console.log(`PASS ${engine} ${viewport.width}x${viewport.height}: inner scroll, fixed controls, search, last row, modal, resize and Back restoration`);
  } finally { await context.close(); }
}
async function main() {
  const h = await harness(); let server;
  try {
    for (let i = 0; i < 60; i++) {
      const ev = event('scroll' + i); ev.name = 'Fixture Event ' + String(i).padStart(2, '0');
      ev.remarks = 'Fixture detail line\n'.repeat(90); await h.seed(ev);
    }
    server = await serve(h);
    for (const [engine, kind] of [['chromium', chromium], ['webkit', webkit]]) {
      if (process.env.SCROLL_TEST_ENGINE && process.env.SCROLL_TEST_ENGINE !== engine) continue;
      const browser = await kind.launch(engine === 'chromium' ? { channel: 'chrome', headless: true } : {});
      try { for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) await flow(browser, engine, viewport, server); }
      finally { await browser.close(); }
    }
  } finally { if (server) await server.close(); await h.dispose(); }
}
main().catch(e => { console.error(e.name + ': ' + e.message); process.exitCode = 1; });
