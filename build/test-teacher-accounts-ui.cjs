// Isolated real-Chrome/D1 checks. Uses only the synthetic accounts from the companion test.
// NODE_PATH=/tmp/event-centre-test-tools/node_modules node build/test-teacher-accounts-ui.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { expect } = require('playwright/test');
const { harness, event, fixturePassword, serve } = require('./test-teacher-accounts.cjs');
async function signIn(p, url) {
  await p.goto(url); await p.getByRole('textbox', { name: 'Account', exact: true }).fill('Event Lead');
  await p.locator('#pw').fill(fixturePassword); await p.getByRole('button', { name: 'Sign In', exact: true }).click();
  await p.getByRole('button', { name: /Fixture Chair/ }).click();
}
async function flow(browser, viewport, recover) {
  const h = await harness(); let server, context;
  try {
    if (recover) await h.seed(event('math', ['WKW2']));
    else { await h.save(event('math', ['NCL'])); await h.api('fresh', 'DELETE'); }
    server = await serve(h); context = await browser.newContext({ viewport }); const p = await context.newPage(); const errors = [];
    p.on('pageerror', () => errors.push('page error'));
    p.on('response', r => { if (r.status() >= 400) errors.push('HTTP ' + r.status()); });
    // Reconnaissance/smoke probe on each actual viewport before interacting.
    await p.goto(server.url); await expect(p.getByRole('button', { name: 'Sign In', exact: true })).toBeVisible();
    assert.deepEqual(errors, [], 'sign-in smoke probe is clean');
    const noticeAck = p.waitForResponse(r => r.url().endsWith('/api/fresh') && r.request().method() === 'DELETE');
    await signIn(p, server.url);
    if (recover) await noticeAck;
    await p.getByRole('button', { name: /Fixture Maths/ }).click();
    if (!recover) {
      // Warm the old map exactly as an Event Lead viewing a different teacher's card would.
      await p.getByRole('button', { name: /NCL/ }).click();
      await expect(p.getByRole('button', { name: 'Copy Account', exact: true })).toBeVisible();
      await p.getByRole('button', { name: 'Close', exact: true }).click();
      await p.getByRole('button', { name: 'Edit', exact: true }).click();
      await p.getByRole('textbox', { name: 'Supporting Teacher', exact: true }).last().fill('WKW2');
      await p.getByRole('button', { name: 'Done', exact: true }).click(); await noticeAck;
    }
    await expect(p.getByRole('status')).toContainText("WKW2's account made");
    await p.getByRole('button', { name: /WKW2/ }).click();
    await expect(p.getByRole('button', { name: 'Copy Account', exact: true })).toBeVisible();
    // Check the visible outcome without capturing the fixture's generated password.
    assert.ok(await p.getByRole('button', { name: 'Copy Account', exact: true }).count() === 1, 'one account row and Copy control');
    const before = await h.storedHash('WKW2');
    await p.getByRole('button', { name: 'Close', exact: true }).click(); await p.reload();
    await expect(p.getByRole('heading', { name: 'Events', exact: true })).toBeVisible();
    await expect(p.getByRole('status').filter({ hasText: 'account made' })).toHaveCount(0);
    const state = await h.api('state?full=1');
    assert.ok(!state.body.fresh?.length && before === await h.storedHash('WKW2'), 'reopen has no new credential or notification');
    await p.getByRole('button', { name: /Fixture Maths/ }).click(); await p.getByRole('button', { name: /WKW2/ }).click();
    await expect(p.getByRole('button', { name: 'Copy Account', exact: true })).toBeVisible();
    assert.deepEqual(errors, [], 'browser flow has no page/network errors');
    console.log('PASS Chrome ' + viewport.width + 'x' + viewport.height + (recover ? ' saved-event recovery' : ' normal addition with cached card') + ', Account/Copy and no repeated notice');
  } finally { if (context) await context.close(); if (server) await server.close(); await h.dispose(); }
}
(async () => {
  const b = await chromium.launch({ channel: 'chrome', headless: true });
  try { for (const v of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) { await flow(b, v, false); await flow(b, v, true); } }
  finally { await b.close(); }
})().catch(e => { console.error(e.name + ': ' + e.message); process.exitCode = 1; });
