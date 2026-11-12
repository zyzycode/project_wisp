const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const distribution = values => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: sorted.length, p50Ms: sorted[Math.floor(sorted.length * .5)],
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))], maxMs: sorted.at(-1) };
};

// Measurement only: no invented CPU/RAM/latency acceptance thresholds. The existing
// runner owns the outer timeout, profile isolation, network guard and process cleanup.
exports.measureLifeSoak = async ({ app, win, profile, evaluate }) => {
  const requestedMs = Number(process.env.WISP_LIFE_SOAK_MS ?? 10_000);
  assert.ok(Number.isSafeInteger(requestedMs) && requestedMs >= 10_000 && requestedMs <= 300_000);
  const databaseBytes = () => Object.fromEntries(['', '-wal', '-shm'].map(suffix => {
    try { return [suffix || 'db', fs.statSync(path.join(profile, 'memory', `wisp.sqlite3${suffix}`)).size]; }
    catch (error) { if (error.code === 'ENOENT') return [suffix || 'db', 0]; throw error; }
  }));
  const resources = () => {
    if (typeof process.getActiveResourcesInfo !== 'function') return null;
    const counts = {};
    for (const name of process.getActiveResourcesInfo()) counts[name] = (counts[name] || 0) + 1;
    return counts;
  };
  const snapshot = () => ({
    mainMemoryBytes: process.memoryUsage(), databaseBytes: databaseBytes(), activeResources: resources(),
    listeners: { app: Object.fromEntries(app.eventNames().map(name => [String(name), app.listenerCount(name)])),
      webContents: Object.fromEntries(win.webContents.eventNames().map(name => [String(name), win.webContents.listenerCount(name)])) },
    // Electron reports workingSetSize/peakWorkingSetSize in KiB, cumulativeCPUUsage in seconds.
    processes: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type,
      cpu: metric.cpu, memoryKiB: metric.memory })),
  });
  await evaluate('window.wispAPI.setAutonomyEnabled({enabled:true})');
  const before = snapshot();
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const cpu = process.cpuUsage();
  const latency = [], heartbeatGaps = [];
  let previous = performance.now();
  const heartbeat = setInterval(() => { const now = performance.now(); heartbeatGaps.push(now - previous); previous = now; }, 10);
  try {
    // Bounded real dwell; 7-day fake-time histories are measured in separate tests.
    while (performance.now() - started < requestedMs) {
      const at = performance.now();
      assert.ok(await evaluate('window.wispAPI.ping("life-soak")'));
      latency.push(performance.now() - at);
      await sleep(250);
    }
    const elapsedMs = performance.now() - started;
    const used = process.cpuUsage(cpu);
    clearInterval(heartbeat);
    return { startedAt, requestedMs, realElapsedMs: elapsedMs, simulatedDays: 0,
      environment: { node: process.versions.node, electron: process.versions.electron,
        os: `${os.type()} ${os.release()}`, arch: process.arch, cpu: os.cpus()[0]?.model,
        logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() },
      scenario: 'Local autonomy enabled; synthetic profile; voice disabled after capture/playback smoke; mock provider; no user turns during dwell',
      before, after: snapshot(), mainCpuMs: { user: used.user / 1000, system: used.system / 1000 },
      pingRoundTrip: distribution(latency), mainHeartbeatGap: distribution(heartbeatGaps),
      limitations: ['No whole-app CPU/RAM/latency budget has been approved; these are measurements.',
        'Ping round-trip and Main heartbeat are responsiveness proxies, not Domain tick latency.',
        'Resource counts cover Main Node handles and Electron listeners, not all Chromium/native owners.',
        'STT/TTS inference here uses existing smoke fixtures; no native inference performance claim.',
        'A bounded soak does not establish multi-day native stability.',
        'This dwell does not itself exercise every causal/plan/habit/book/world branch; their accelerated and lifecycle results are reported separately.'] };
  } finally {
    clearInterval(heartbeat);
    await evaluate('window.wispAPI.setAutonomyEnabled({enabled:false})');
  }
};
