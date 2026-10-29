const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const mode = process.argv[2] || 'cancel-load';
const frontend = path.resolve(__dirname, '../..');
app.setPath('userData', process.env.WISP_SMOKE_PROFILE || path.join(require('node:os').tmpdir(), `wisp-native-voice-${process.pid}`));
const report = { runId: process.env.WISP_SMOKE_RUN_ID, electron: process.versions.electron, checks: [] };
const save = () => { if (process.env.WISP_SMOKE_OUTPUT) fs.writeFileSync(path.join(process.env.WISP_SMOKE_OUTPUT, 'electron.json'), JSON.stringify(report, null, 2)); };
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const { createNativeSpeechProbe } = require(path.join(frontend, 'dist-electron/main/voice-smoke.js'));
  const entry = mode === 'crash' ? path.join(__dirname, 'voice-native-crash.cjs') : path.join(frontend, 'dist-electron/main/speech-worker.js');
  const adapter = createNativeSpeechProbe(path.join(frontend, '.cache'), entry);
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 10);
  const started = performance.now();
  try {
    console.log(JSON.stringify({ phase: 'start', mode }));
    if (mode.startsWith('cancel') || mode === 'crash') {
      const abort = new AbortController();
      const pending = adapter.synthesize(mode === 'cancel-run' ? 'Это проверка отмены длительного синтеза речи. '.repeat(12) : 'Привет!', 'ru', abort.signal);
      const rejected = assert.rejects(pending);
      if (mode.startsWith('cancel')) { await new Promise(resolve => setTimeout(resolve, mode === 'cancel-run' ? 10000 : 1000)); abort.abort(); }
      await rejected;
      assert.equal(window.isDestroyed(), false);
      console.log(JSON.stringify({ phase: 'main-survived-cancel-or-crash', mode, ticks }));
      report.checks.push({ name: `native-voice-${mode}-main-survived`, status: 'PASS' });
    }
    if (mode !== 'crash') {
      const speech = await adapter.synthesize('Привет!', 'ru', new AbortController().signal);
      assert.ok(speech.samples instanceof Float32Array && speech.samples.length > 0);
      assert.ok(speech.samples.every(n => Number.isFinite(n) && Math.abs(n) <= 1));
      console.log(JSON.stringify({ phase: 'speech-generated', samples: speech.samples.length }));
      report.checks.push({ name: 'native-voice-fresh-synthesis', status: 'PASS', detail: `${speech.samples.length} finite PCM samples` });
    }
    await adapter.dispose();
    assert.equal(window.isDestroyed(), false); assert.ok(ticks > 0);
    console.log(JSON.stringify({ phase: 'main-survived', mode, ticks, elapsedMs: Math.round(performance.now() - started) }));
    report.checks.push({ name: 'native-voice-dispose', status: 'PASS' }, { name: 'application-quit', status: 'PASS' }); save();
    clearInterval(heartbeat); window.destroy(); app.quit();
  } catch (error) {
    clearInterval(heartbeat); console.error(JSON.stringify({ phase: 'failure', name: error.name }));
    report.checks.push({ name: 'native-voice-regression', status: 'FAIL', detail: error.name }); save();
    await adapter.dispose(); app.exit(1);
  }
});
