const { app, BrowserWindow, utilityProcess } = require('electron');
const { Worker } = require('node:worker_threads');
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const frontend = path.resolve(__dirname, '../..');
app.setPath('userData', process.env.WISP_SMOKE_PROFILE);
const report = { runId: process.env.WISP_SMOKE_RUN_ID, checks: [] };
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const { createCoordinatedVoiceProbe } = require(path.join(frontend, 'dist-electron/main/voice-smoke.js'));
  const probe = createCoordinatedVoiceProbe(path.join(frontend, '.cache'), path.join(frontend, 'dist-electron/main/voice-worker.js'), path.join(frontend, 'dist-electron/main/speech-seeded.js'));
  const originalFork = utilityProcess.fork, originalPost = Worker.prototype.postMessage, originalEmit = Worker.prototype.emit;
  let sttNativeDoneAt = null, ttsNativePostedAt = null, posted;
  const sttPosted = new Promise(resolve => { posted = resolve; });
  utilityProcess.fork = (...args) => {
    const child = originalFork(...args), send = child.postMessage.bind(child);
    child.postMessage = (...values) => { ttsNativePostedAt = performance.now(); return send(...values); };
    return child;
  };
  let ticks = 0, maxGapMs = 0, previous = performance.now();
  const heartbeat = setInterval(() => { const now = performance.now(); maxGapMs = Math.max(maxGapMs, now - previous); previous = now; ticks++; }, 10);
  try {
    await probe.input.initialize();
    const warmup = await probe.output.synthesize('Hello!', 'en', new AbortController().signal);
    ttsNativePostedAt = null;
    const pcm = warmup.samples;
    const samples = Float32Array.from({ length: Math.floor(pcm.length * 2 / 3) }, (_, i) => {
      const position = i * 1.5, lo = Math.floor(position), fraction = position - lo;
      return pcm[lo] * (1 - fraction) + pcm[Math.min(lo + 1, pcm.length - 1)] * fraction;
    });
    Worker.prototype.postMessage = function (...args) { const result = originalPost.apply(this, args); posted(); return result; };
    Worker.prototype.emit = function (event, ...args) {
      if (event === 'message' && args[0]?.ok === true) sttNativeDoneAt = performance.now();
      return originalEmit.call(this, event, ...args);
    };
    const transcription = probe.input.transcribe({ samples, sampleRate: 16000, language: 'en' }, new AbortController().signal);
    await sttPosted;
    const synthesis = probe.output.synthesize('Hello!', 'en', new AbortController().signal);
    await Promise.resolve(); await Promise.resolve();
    assert.equal(ttsNativePostedAt, null, 'TTS must wait for STT native completion');
    const recognized = await transcription;
    assert.equal(recognized.ok, true);
    assert.ok(recognized.value.toLowerCase().replace(/[^a-z]/g, '') === 'hello');
    const speech = await synthesis;
    assert.ok(speech.samples.length > 0 && speech.samples.every(Number.isFinite));
    assert.ok(sttNativeDoneAt !== null && ttsNativePostedAt >= sttNativeDoneAt);
    assert.equal(win.isDestroyed(), false);
    report.coordination = { sttNativeDoneAt, ttsNativePostedAt, samples: speech.samples.length, ticks, maxGapMs };
    report.checks.push({ name: 'native-stt-tts-admission', status: 'PASS' });
  } catch (error) {
    report.checks.push({ name: 'native-stt-tts-admission', status: 'FAIL', detail: error.message });
  } finally {
    utilityProcess.fork = originalFork; Worker.prototype.postMessage = originalPost; Worker.prototype.emit = originalEmit;
    await probe.input.dispose(); await probe.output.dispose(); clearInterval(heartbeat); win.destroy();
    report.checks.push({ name: 'application-quit', status: 'PASS' });
    fs.writeFileSync(path.join(process.env.WISP_SMOKE_OUTPUT, 'electron.json'), JSON.stringify(report, null, 2));
    app.exit(report.checks.some(item => item.status === 'FAIL') ? 1 : 0);
  }
});
