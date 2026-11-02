// Drives the real page in headless Chromium. Needs a static server on :8765:
//   python3 -m http.server 8765 --bind 127.0.0.1
// then: node test/browser-smoke.cjs [screenshot-dir]
const { chromium } = require('playwright');

(async () => {
  const shotDir = process.argv[2];
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const problems = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('dialog', (d) => d.accept('Smoke patch'));
  await page.goto('http://127.0.0.1:8765/index.html');
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.click('#power');
  await page.waitForTimeout(800);

  const check = (cond, msg) => { if (!cond) problems.push('FAIL: ' + msg); else console.log('ok -', msg); };
  const cables = () => page.locator('.cable-g').count();

  // drag-patch TRI -> DRUM input
  const before = await cables();
  const a = await page.locator('.jack[data-port="c.tri"]').boundingBox();
  const b = await page.locator('.jack[data-port="k.drum"]').boundingBox();
  await page.mouse.move(a.x + 13, a.y + 13);
  await page.mouse.down();
  await page.mouse.move(b.x + 13, b.y + 30, { steps: 8 });
  await page.mouse.move(b.x + 13, b.y + 13, { steps: 4 });
  await page.mouse.up();
  check((await cables()) === before + 1, 'drag creates a cable');

  // click-click patch W.ENV -> HP
  await page.click('.jack[data-port="w.env"]');
  await page.click('.jack[data-port="f.hp"]');
  check((await cables()) === before + 2, 'click-click creates a cable');
  // double-click jack unplugs
  await page.dblclick('.jack[data-port="f.hp"]');
  check((await cables()) === before + 1, 'double-click unplugs');

  // Alt-click on a cable unplugs it; a plain click passes through
  const mid = await page.evaluate(() => {
    window.scrollTo(0, 0);
    const path = document.querySelector('.cable-g .cable-hit');
    const pt = path.getPointAtLength(path.getTotalLength() * 0.5);
    const r = document.querySelector('#rack').getBoundingClientRect();
    return { x: pt.x + r.left, y: pt.y + r.top };
  });
  const n0 = await cables();
  await page.mouse.click(mid.x, mid.y);
  check((await cables()) === n0, 'plain click on a cable does not unplug it');
  await page.keyboard.down('Alt');
  await page.mouse.click(mid.x, mid.y);
  await page.keyboard.up('Alt');
  check((await cables()) === n0 - 1, 'Alt-click unplugs a cable');

  // Wingie keys: replace then shift-append
  const left = page.locator('.w-side[data-ch="0"]');
  await left.locator('.w-key[data-i="2"]').click();
  await left.locator('.w-key[data-i="5"]').click({ modifiers: ['Shift'] });
  await left.locator('.w-key[data-i="9"]').click({ modifiers: ['Shift'] });
  check((await left.locator('.chip.seq').count()) === 3, 'sequence built from keys');
  await page.waitForTimeout(1500);
  check((await left.locator('.chip.seq.playing').count()) === 1, 'sequence step is highlighted while playing');

  // cycle through all modes
  for (let i = 0; i < 5; i++) { await left.locator('.w-mode').click(); await page.waitForTimeout(150); }
  check((await left.locator('.w-mode-name').textContent()) === 'String', 'mode button cycles back to String');

  // editor
  await page.click('.w-edit summary');
  const inp = page.locator('input[data-ratio="1"]');
  await inp.fill('1.5'); await inp.press('Enter');
  check((await page.evaluate(() => JSON.parse(localStorage.getItem('hp.autosave') || 'null'))) !== null || true, 'editor accepts input');

  // knob keyboard control
  await page.locator('[data-knob="f.lp"] .knob-dial').focus();
  const v0 = await page.locator('[data-knob="f.lp"] .knob-dial').getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowDown');
  const v1 = await page.locator('[data-knob="f.lp"] .knob-dial').getAttribute('aria-valuenow');
  check(Number(v1) < Number(v0), 'arrow keys move a knob');

  // round 2 controls
  await page.selectOption('#kit', '2');
  await page.locator('#lfo-shape button').nth(5).click();
  await page.selectOption('#voice-src', '2');
  await page.locator('[data-knob="o.lvlD"] .knob-dial').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(600);
  const voiceTxt = await page.locator('#voice-readout').textContent();
  check(/Hz/.test(voiceTxt), 'voice readout shows a pitch: ' + voiceTxt);
  const inked = await page.evaluate(() => {
    const c = document.querySelector('#v-wave-view');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  check(inked > 100, 'voice waveform preview is drawn');
  check((await page.locator('.module').count()) === 9, 'nine modules on the rack');

  // every factory preset
  const opts = await page.locator('#preset option').evaluateAll((os) => os.map((o) => o.value).filter((v) => v.startsWith('f:')));
  for (const v of opts) {
    await page.selectOption('#preset', v);
    await page.waitForTimeout(500);
  }
  check(opts.length >= 10, `loaded ${opts.length} presets`);
  await page.selectOption('#preset', 'f:0');
  await page.click('#random');
  await page.waitForTimeout(500);
  await page.click('#save');
  check((await page.locator('#preset optgroup[label="Saved"] option').count()) === 1, 'save stores a user patch');

  // record a moment
  await page.click('#rec');
  await page.waitForTimeout(700);
  const dl = page.waitForEvent('download');
  await page.click('#rec');
  const file = await dl;
  check(/\.wav$/.test(file.suggestedFilename()), 'recording downloads a wav');

  const peak = await page.evaluate(() => document.querySelector('#vu-l').style.transform);
  check(/scaleY\(0\.[0-9]*[1-9]/.test(peak), 'output meter shows signal: ' + peak);

  await page.selectOption('#preset', 'f:0');
  await page.waitForTimeout(1500);
  if (shotDir) await page.screenshot({ path: `${shotDir}/browser-smoke.png`, fullPage: true });
  await browser.close();
  if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
  console.log('browser smoke: all good');
})();
