const { app, BrowserWindow, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = process.env.WISP_SMOKE_OUTPUT;
const profile = process.env.WISP_SMOKE_PROFILE;
if (!output || !profile) throw new Error('Run through scripts/wisp.mjs smoke:desktop');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const report = { runId: process.env.WISP_SMOKE_RUN_ID, electron: process.versions.electron, checks: [] };
const errors = [];
let completed = false;
let activeWindow;
const record = (name, status, detail) => report.checks.push({ name, status, ...(detail ? { detail } : {}) });
const save = () => fs.writeFileSync(path.join(output, 'electron.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) { if (await predicate()) return; await sleep(50); }
  throw new Error(`${label} timeout`);
}
process.on('uncaughtException', error => { record('uncaught-main-error', 'FAIL', error.name); save(); app.exit(1); });
process.on('unhandledRejection', error => { record('unhandled-main-rejection', 'FAIL', error?.name || 'Error'); save(); app.exit(1); });
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', event => {
    if (event.level === 'error') errors.push(`renderer-console-error: ${event.message.slice(0, 300)}`);
  });
  contents.on('render-process-gone', () => errors.push('renderer-process-gone'));
  contents.on('preload-error', () => errors.push('preload-error'));
  contents.on('did-fail-load', (_event, code) => { if (code !== -3) errors.push(`load-error-${code}`); });
});
app.on('will-quit', () => {
  record('application-quit', completed && errors.length === 0 ? 'PASS' : 'FAIL');
  if (errors.length) record('runtime-errors', 'FAIL', [...new Set(errors)].join(', '));
  save();
});

// Register the network guard before importing Main: the isolated session can only reach its dev server.
app.whenReady().then(() => {
  const origin = new URL(process.env.VITE_DEV_SERVER_URL).origin;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url);
    const local = url.origin === origin || (url.protocol === 'ws:' && url.host === new URL(origin).host);
    callback({ cancel: !local && !['file:', 'data:', 'blob:', 'devtools:'].includes(url.protocol) });
  });
});
require(path.resolve(__dirname, '../../dist-electron/main/index.js'));

(async () => {
  try {
    await app.whenReady();
    await until(() => BrowserWindow.getAllWindows().some(win => win.isVisible()), 'Visible window');
    const win = BrowserWindow.getAllWindows().find(candidate => candidate.isVisible());
    activeWindow = win;
    const evaluate = expression => win.webContents.executeJavaScript(expression);
    await until(() => evaluate('Boolean(document.querySelector(".wisp-character-root") && window.wispAPI)'), 'Renderer and preload');
    assert.equal(app.getPath('userData'), profile);
    assert.equal(win.webContents.getLastWebPreferences().sandbox, true);
    assert.equal(win.webContents.getLastWebPreferences().contextIsolation, true);
    assert.equal(win.webContents.getLastWebPreferences().nodeIntegration, false);
    record('window-renderer-preload', 'PASS');
    const ping = await evaluate('window.wispAPI.ping("smoke")');
    assert.ok(ping);
    await evaluate('window.wispAPI.setAutonomyEnabled({enabled:false})');
    record('typed-bridge', 'PASS');
    const colour = await evaluate('getComputedStyle(document.body).backgroundColor');
    assert.equal(colour, 'rgba(0, 0, 0, 0)');
    record('transparent-body-style', 'PASS', 'CSS only; compositor transparency remains manual');
    report.displays = screen.getAllDisplays().map(display => ({ bounds: display.bounds, scaleFactor: display.scaleFactor }));
    assert.ok(report.displays.every(display => display.scaleFactor > 0));
    record('display-scale-metadata', 'PASS');
    win.focus();
    await until(() => win.isFocused(), 'Native window focus');
    win.webContents.focus();
    await until(() => evaluate('document.hasFocus()'), 'Renderer focus');
    const rect = await evaluate(`(() => { const target=document.querySelector('.wisp-character-root'); const r=target.getBoundingClientRect(); const point={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; if(!target.contains(document.elementFromPoint(point.x,point.y))) throw new Error('Character centre is not hit-testable'); window.__smokeMouseEntered=false; target.addEventListener('mousemove',()=>{window.__smokeMouseEntered=true;},{once:true}); return point; })()`);
    report.menuInput = { point: rect, bounds: win.getBounds(), focused: win.isFocused() };
    win.webContents.sendInputEvent({ type: 'mouseMove', ...rect });
    await until(() => evaluate('window.__smokeMouseEntered === true'), 'Mouse entered character');
    win.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...rect });
    win.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...rect });
    await until(() => evaluate('Boolean(document.querySelector(".wisp-context-menu"))'), 'Context menu');
    record('context-menu-injected-input', 'PASS');
    await evaluate('document.querySelector(".menu-close-btn").click()');
    await until(() => evaluate('!document.querySelector(".wisp-context-menu")'), 'Menu close');
    // Injected DOM pointer events exercise React → typed IPC → Main, not global OS pointer capture.
    const before = await evaluate('window.wispAPI.getPosition()');
    await evaluate(`(() => { const target=document.querySelector('.wisp-character-root'); const options={bubbles:true,pointerId:1,button:0,buttons:1,screenX:300,screenY:300}; target.dispatchEvent(new PointerEvent('pointerdown',options)); window.dispatchEvent(new PointerEvent('pointermove',{...options,screenX:320})); })()`);
    await until(() => evaluate('Boolean(document.querySelector(".pet-container.is-dragging"))'), 'Drag start');
    await evaluate(`window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:1,buttons:1,screenX:360,screenY:260}))`);
    await until(async () => { const p = await evaluate('window.wispAPI.getPosition()'); return p.x !== before.x || p.y !== before.y; }, 'Drag movement');
    await evaluate(`window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:1,button:0,screenX:360,screenY:260}))`);
    await until(() => evaluate('!document.querySelector(".pet-container.is-dragging")'), 'Drag release');
    record('drag-release-injected-pointer', 'PASS');
    const capture = await win.webContents.capturePage();
    assert.equal(capture.isEmpty(), false);
    fs.writeFileSync(path.join(output, 'window.png'), capture.toPNG());
    record('rendered-frame', 'PASS');
    for (const [name, detail] of [
      ['compositor-transparency', 'Inspect desktop through empty window pixels'],
      ['native-pointer-drag', 'Verify physical pointer capture and release outside window'],
      ['dpi-transition', 'Move between displays/scales and inspect clipping'],
      ['tray', 'No tray implementation in current product; verify if capability is introduced'],
    ]) record(name, 'NOT RUN', detail);
    assert.equal(errors.length, 0, 'Renderer/preload runtime errors');
    completed = true;
    save();
    await evaluate('window.wispAPI.closeApp()').catch(() => { /* Renderer closes during the real quit path. */ });
  } catch (error) {
    record('native-scenario', 'FAIL', error.message);
    if (activeWindow && !activeWindow.isDestroyed()) {
      report.failureWindow = { bounds: activeWindow.getBounds(), focused: activeWindow.isFocused() };
      try {
        const capture = await Promise.race([activeWindow.webContents.capturePage(),
          sleep(2000).then(() => { throw new Error('Failure capture timeout'); })]);
        fs.writeFileSync(path.join(output, 'failure-window.png'), capture.toPNG());
      } catch { record('failure-capture', 'NOT RUN', 'Window capture unavailable'); }
    }
    save();
    app.quit();
  }
})();
