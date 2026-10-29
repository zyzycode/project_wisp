const { app, BrowserWindow, screen, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const output = process.env.WISP_SMOKE_OUTPUT;
const profile = process.env.WISP_SMOKE_PROFILE;
if (!output || !profile) throw new Error('Run through scripts/wisp.mjs smoke:desktop');
// Test-only Chromium device: never opens a physical microphone; permissions remain real.
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
// Deterministic synthetic speech-like bursts and silence exercise end-of-utterance VAD.
const microphoneFile = path.join(output, 'fake-voice.wav');
const pcm = Buffer.alloc(44 + 32_000 * 2);
pcm.write('RIFF'); pcm.writeUInt32LE(pcm.length - 8, 4); pcm.write('WAVEfmt ', 8);
pcm.writeUInt32LE(16, 16); pcm.writeUInt16LE(1, 20); pcm.writeUInt16LE(1, 22);
pcm.writeUInt32LE(16_000, 24); pcm.writeUInt32LE(32_000, 28); pcm.writeUInt16LE(2, 32); pcm.writeUInt16LE(16, 34);
pcm.write('data', 36); pcm.writeUInt32LE(pcm.length - 44, 40);
for (let i = 0; i < 8_000; i++) {
  const hz = 180 + Math.floor(i / 640) % 5 * 40;
  pcm.writeInt16LE(Math.round(6000 * Math.sin(2 * Math.PI * hz * i / 16_000)), 44 + i * 2);
}
fs.writeFileSync(microphoneFile, pcm);
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', microphoneFile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const report = { runId: process.env.WISP_SMOKE_RUN_ID, electron: process.versions.electron, checks: [] };
const errors = [];
let completed = false;
let activeWindow;
const record = (name, status, detail) => report.checks.push({ name, status, ...(detail ? { detail } : {}) });
const save = () => fs.writeFileSync(path.join(output, 'electron.json'), JSON.stringify(report, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label, timeout = 10_000) {
  const deadline = Date.now() + timeout;
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
    await until(() => evaluate(`Array.from(document.querySelectorAll('.chat-voice-controls button')).some(b=>b.textContent==='Выключить микрофон' && b.getAttribute('aria-pressed')==='true')`), 'Microphone startup on');
    await until(() => evaluate(`document.querySelector('.chat-voice-output button')?.getAttribute('aria-pressed')==='true'`), 'Voice output startup on');
    record('voice-startup-defaults-on', 'PASS', 'One-shot Main grants enable both modes on ordinary startup');
    await evaluate(`Array.from(document.querySelectorAll('.chat-voice-controls button')).find(b=>b.textContent==='Выключить микрофон').click(); document.querySelector('.chat-voice-output button').click()`);
    await until(() => evaluate(`document.querySelector('.chat-voice-output button')?.getAttribute('aria-pressed')==='false'`), 'Explicit voice off');
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
    await sleep(200);
    await evaluate(`if(!document.querySelector('.wisp-context-menu')) document.querySelector('.wisp-character-root').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await until(() => evaluate(`Boolean(document.querySelector('.audio-output-settings'))`), 'Audio settings section');
    await evaluate(`(() => {document.querySelector('.audio-output-settings').open=true; window.__speechStarts=0; window.__sinkIds=[];
      const start=AudioBufferSourceNode.prototype.start; AudioBufferSourceNode.prototype.start=function(...args){window.__speechStarts++;return start.apply(this,args);};
      const route=AudioContext.prototype.setSinkId; if(typeof route!=='function') throw new Error('setSinkId unavailable');
      AudioContext.prototype.setSinkId=function(id){window.__sinkIds.push(id);return route.call(this,id).catch(e=>{window.__sinkError=e.name;throw e;});};})()`);
    await evaluate(`(() => {const toggle=document.querySelector('.audio-output-settings .voice-setting-toggle input'); if(!toggle.checked) toggle.click();})()`);
    await until(() => evaluate(`Array.from(document.querySelectorAll('.chat-voice-status')).some(e=>e.textContent.includes('слушаю'))`), 'Microphone permission for device labels');
    await until(() => evaluate(`Array.from(document.querySelector('[aria-label="Устройство вывода звука"]')?.options || []).some(o=>o.value && o.value!=='__loading__')`), 'Enumerated audio outputs');
    const selectedSink = await evaluate(`(() => {const select=document.querySelector('[aria-label="Устройство вывода звука"]'); const options=Array.from(select.options).filter(o=>o.value && o.value!=='__loading__' && !o.disabled);const chosen=options.find(o=>/Built-in|Встроен/.test(o.textContent))||options[0];select.value=chosen.value;select.dispatchEvent(new Event('change',{bubbles:true}));return chosen.value;})()`);
    await until(async () => { const preference=await evaluate('window.wispAPI.voiceOutput.readDevice()'); return preference.ok && preference.value.deviceId===selectedSink; }, 'Persist selected audio device');
    await evaluate(`Array.from(document.querySelectorAll('.audio-output-settings button')).find(b=>b.textContent==='Проверить звук').click()`);
    await until(() => evaluate('window.__speechStarts===1'), 'Test tone source start');
    assert.equal(await evaluate('window.__sinkIds.at(-1)'), selectedSink);
    await until(async () => {const s=await evaluate('window.wispAPI.voiceOutput.readStatus()');return s.ok&&!s.value.active;}, 'Test tone lease acknowledged');
    await evaluate('window.wispAPI.voiceInput.disable()');
    await until(() => evaluate(`Array.from(document.querySelectorAll('.chat-voice-controls button')).some(b=>b.textContent==='Включить микрофон')`), 'Microphone explicitly off for playback');
    await evaluate(`if(!document.querySelector('.wisp-context-menu')) document.querySelector('.wisp-character-root').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))`);
    await until(() => evaluate(`Boolean(document.querySelector('.audio-output-settings'))`), 'Audio settings for microphone-off tone');
    await evaluate(`document.querySelector('.audio-output-settings').open=true`);
    await until(() => evaluate(`Array.from(document.querySelectorAll('.audio-output-settings button')).some(b=>b.textContent==='Проверить звук'&&!b.disabled)`), 'Test tone control ready');
    await evaluate(`Array.from(document.querySelectorAll('.audio-output-settings button')).find(b=>b.textContent==='Проверить звук').click()`);
    try { await until(() => evaluate('window.__speechStarts===2'), 'Selected device playback with microphone off'); }
    catch(error) { report.audioDiagnostic=await evaluate(`({starts:window.__speechStarts,sinks:window.__sinkIds.length,sinkError:window.__sinkError,errors:Array.from(document.querySelectorAll('.audio-output-settings [role="alert"],.chat-voice-output [role="alert"]')).map(e=>e.textContent)})`); throw error; }
    await until(async () => {const s=await evaluate('window.wispAPI.voiceOutput.readStatus()');return s.ok&&!s.value.active;}, 'Microphone-off tone acknowledged');
    const audioFrame=await win.webContents.capturePage(); fs.writeFileSync(path.join(output,'voice-settings.png'),audioFrame.toPNG());
    record('voice-output-selected-device-settings', 'PASS', 'Persisted explicit device → setSinkId → tone/ack with microphone on AND off');
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
    const voiceContext = await evaluate(`new Promise(resolve => {
      const unsubscribe = window.wispAPI.onBrainState(snapshot => {
        queueMicrotask(() => unsubscribe()); resolve({streamId:snapshot.streamId,conversationId:snapshot.dialogue.conversationId});
      });
    })`);
    const installedVoice = await evaluate('window.wispAPI.voiceInput.readStatus()');
    assert.equal(installedVoice.ok, true);
    assert.equal(installedVoice.value.state, 'ready');
    record('bundled-voice-model-ready', 'PASS', 'Real installed resource verified; no runtime download');
    const installedOutput = await evaluate('window.wispAPI.voiceOutput.readStatus()');
    assert.equal(installedOutput.ok, true); assert.equal(installedOutput.value.ready, true);
    assert.equal(installedOutput.value.enabled, false);
    await until(() => evaluate(`Array.from(document.querySelectorAll('.chat-voice-output button')).some(button => button.textContent === 'Включить озвучку' && !button.disabled)`), 'Speech output control');
    const outputBounds = await evaluate(`(() => { const rect=document.querySelector('.chat-voice-output').getBoundingClientRect(); return {bottom:rect.bottom,height:innerHeight}; })()`);
    assert.ok(outputBounds.bottom <= outputBounds.height, 'Speech output controls must fit compact window');
    await evaluate(`document.querySelector('.chat-voice-output button').click()`);
    await until(() => evaluate(`document.querySelector('.chat-voice-output button').getAttribute('aria-pressed') === 'true'`), 'Enable speech output');
    await evaluate(`document.querySelector('.chat-voice-output button').click()`);
    await until(() => evaluate(`document.querySelector('.chat-voice-output button').getAttribute('aria-pressed') === 'false'`), 'Disable speech output');
    record('voice-output-offline-model-and-controls', 'PASS', 'Verified model, typed IPC, explicit off/on and compact layout; no voice cloning');
    const { installVoiceOutputSmoke } = require(path.resolve(__dirname, '../../dist-electron/main/voice-smoke.js'));
    const outputSnapshot = await evaluate(`new Promise(resolve => {
      const unsubscribe=window.wispAPI.onBrainState(snapshot => { queueMicrotask(() => unsubscribe()); resolve(snapshot); });
    })`);
    const realTts = process.env.WISP_TTS_NATIVE_PROBE === '1';
    const outputSmoke = await installVoiceOutputSmoke(win.webContents, outputSnapshot, realTts, selectedSink);
    await evaluate(`(() => {
      window.__speechStarts=0;
      document.querySelector('.chat-voice-output button').click();
    })()`);
    await until(() => evaluate(`document.querySelector('.chat-voice-output button').getAttribute('aria-pressed') === 'true'`), 'Speech output enabled');
    await evaluate(`document.querySelector('.pet-label').click()`);
    await until(() => evaluate(`Boolean(document.querySelector('.chat-input-field'))`), 'Composer for synthetic greeting');
    await evaluate(`document.querySelector('.chat-input-field').focus()`);
    await win.webContents.insertText('Привет');
    await until(() => evaluate(`document.querySelector('.chat-send-btn')?.disabled === false`), 'Synthetic greeting ready to send');
    await evaluate(`document.querySelector('.chat-input-form').requestSubmit()`);
    try { await until(() => outputSmoke.getStats().syntheses === 1, 'Actual reply synthesis admission'); }
    catch (error) { report.voiceOutputDiagnostic = outputSmoke.getStats(); throw error; }
    await until(() => evaluate('window.__speechStarts === 1'), 'PCM across preload into actual Web Audio playback', realTts ? 125000 : 10000);
    await until(() => outputSmoke.getStats().acknowledgements === 1, 'Matching playback acknowledgement', realTts ? 125000 : 10000);
    await until(() => evaluate('!document.querySelector(".speech-text")'), 'Voice mode replaces reply bubble');
    record('voice-output-reply-pcm-playback', 'PASS', 'Real successful mock Dialogue reply → output adapter → Main synthesis → Preload PCM → Web Audio start/end acknowledgement');
    if (realTts) record('voice-output-real-onnx-playback', 'PASS', 'Actual Ono_Anna model in utility process, fixed synthetic reply, real Preload/Web Audio, Main survived');
    outputSmoke.failNext();
    await evaluate(`if(!document.querySelector('.chat-input-field')) document.querySelector('.pet-label').click()`);
    await until(() => evaluate(`Boolean(document.querySelector('.chat-input-field'))`), 'Composer for fallback');
    await evaluate(`document.querySelector('.chat-input-field').focus()`);
    await win.webContents.insertText('Привет');
    await until(() => evaluate(`document.querySelector('.chat-send-btn')?.disabled === false`), 'Fallback greeting ready to send');
    await evaluate(`document.querySelector('.chat-input-form').requestSubmit()`);
    await until(() => outputSmoke.getStats().syntheses === 2, 'Synthetic synthesis failure');
    await until(() => evaluate(`Boolean(document.querySelector('.speech-text')?.textContent && document.querySelector('.chat-voice-output [role="alert"]'))`), 'Voice failure shows text fallback');
    assert.equal(await evaluate('window.__speechStarts'), 1);
    record('voice-output-failed-synthesis-text-fallback', 'PASS', 'Failure returns the reply to text; cancellation cannot swallow fallback');
    await evaluate(`document.querySelector('.chat-voice-output button').click()`);
    await until(() => evaluate(`document.querySelector('.chat-voice-output button').getAttribute('aria-pressed') === 'false'`), 'Speech output disabled after playback');
    await outputSmoke.dispose();
    const { installVoiceSmoke } = require(path.resolve(__dirname, '../../dist-electron/main/voice-smoke.js'));
    const voiceSmoke = installVoiceSmoke(win.webContents, voiceContext);
    const noLease = await evaluate(`navigator.mediaDevices.getUserMedia({audio:true}).then(stream => {
      stream.getTracks().forEach(track => track.stop()); return 'unexpected-access';
    }, error => error.name)`);
    assert.equal(noLease, 'NotAllowedError');
    await evaluate(`(() => {
      window.__voiceTracks = [];
      window.__voiceTurns = [];
      window.__voiceUnsubscribe = window.wispAPI.onBrainState(snapshot => {
        if(snapshot.dialogue.turn.phase !== 'idle') window.__voiceTurns.push(snapshot.dialogue.turn.phase);
      });
      const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.mediaDevices.getUserMedia = async constraints => {
        const stream = await capture(constraints); window.__voiceTracks.push(...stream.getTracks()); return stream;
      };
      document.querySelector('.pet-label').click();
    })()`);
    await until(() => evaluate(`Array.from(document.querySelectorAll('.chat-voice button')).some(button => button.textContent === 'Включить микрофон' && !button.disabled)`), 'Voice mode control');
    const clickVoice = async label => evaluate(`Array.from(document.querySelectorAll('.chat-voice button')).find(button => button.textContent === ${JSON.stringify(label)}).click()`);
    await evaluate(`document.querySelector('.chat-input-field').value = 'manual draft'`);
    await clickVoice('Включить микрофон');
    await until(() => evaluate(`document.querySelector('.chat-voice-status')?.textContent.includes('слушаю')`), 'Fake microphone listening');
    assert.equal(voiceSmoke.getStats().leased, true);
    await evaluate(`document.querySelector('.chat-cancel-btn').click()`);
    assert.equal(await evaluate(`Boolean(document.querySelector('.chat-input-field'))`), false);
    await until(() => voiceSmoke.getStats().transcriptions >= 2, 'Continuous utterances with composer closed');
    assert.ok(voiceSmoke.getStats().samples > 0 && voiceSmoke.getStats().samples <= 240000);
    assert.equal(voiceSmoke.getStats().leased, true);
    assert.equal(await evaluate('window.__voiceTracks.length > 0 && window.__voiceTracks.every(track => track.readyState === "live")'), true);
    assert.ok((await evaluate('window.__voiceTurns')).length > 0);
    const voiceFrame = await win.webContents.capturePage();
    fs.writeFileSync(path.join(output, 'voice-listening.png'), voiceFrame.toPNG());
    await clickVoice('Выключить микрофон');
    await until(() => !voiceSmoke.getStats().leased, 'Mode off');
    assert.equal(await evaluate('window.__voiceTracks.every(track => track.readyState === "ended")'), true);
    const finished = voiceSmoke.getStats().transcriptions;
    await sleep(1100);
    assert.equal(voiceSmoke.getStats().transcriptions, finished);
    await evaluate('window.__voiceUnsubscribe()');
    record('voice-continuous-microphone-auto-submit', 'PASS', 'Real capture/VAD/IPC/permissions; two automatic Dialogue turns with composer closed; synthetic inference');
    await voiceSmoke.dispose();
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
