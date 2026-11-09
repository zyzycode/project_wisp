const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Only external sensor inputs are synthetic. Main, activities, writes and rendering
// remain the application under test; this never moves the user's physical pointer.
exports.installLifeInputs = ({ screen, powerMonitor, rootPivotOffset }) => {
  const cursor = screen.getCursorScreenPoint;
  const idle = powerMonitor.getSystemIdleTime;
  let win, latest, mode = 'park', offset = 40, originalSend;
  const trace = [];
  let previous;
  screen.getCursorScreenPoint = () => {
    if (mode === 'park' || !win || win.isDestroyed()) return { x: -10000, y: -10000 };
    const bounds = win.getBounds();
    const root = latest?.motion.rootScreenPosition ?? { x: bounds.x + rootPivotOffset.x, y: bounds.y + rootPivotOffset.y };
    return { x: Math.round(root.x + offset), y: Math.round(root.y - 10) };
  };
  // Zero means unconfirmed in the canonical adapter, so use a valid fresh-active 1s sample.
  powerMonitor.getSystemIdleTime = () => 1;
  return {
    attach(window) {
      win = window;
      originalSend = win.webContents.send;
      win.webContents.send = function(channel, ...args) {
        if (channel === 'wisp:brain-state') {
          latest = args[0];
          const key = JSON.stringify([latest.activity?.runId, latest.activity?.phaseId, latest.motion.phase, latest.visualIntent.kind, latest.visualIntent.expressionHint]);
          if (key !== previous) { previous = key; trace.push({ atMs:latest.sampledAtMs,activity:latest.activity,motion:latest.motion,visual:latest.visualIntent.kind,expression:latest.visualIntent.expressionHint,needs:latest.character.needs }); if(trace.length>100)trace.shift(); }
        }
        return originalSend.call(this, channel, ...args);
      };
    },
    observe(snapshot) { latest = snapshot; },
    latest: () => latest, trace: () => trace,
    follow() { mode = 'follow'; },
    move(value) { offset = value; },
    park() { mode = 'park'; },
    dispose() {
      screen.getCursorScreenPoint = cursor; powerMonitor.getSystemIdleTime = idle;
      if (win && !win.isDestroyed() && originalSend) win.webContents.send = originalSend;
    },
  };
};

const visibleProof = async evaluate => evaluate(`({
  frames:Array.from(document.querySelectorAll('[data-frame-source]')).map(image=>image.getAttribute('data-frame-source')),
  speech:document.querySelector('.speech-text')?.textContent ?? null,
  expression:document.querySelector('.wisp-character-root')?.getAttribute('data-expression') ?? null,
  svg:!!document.querySelector('[data-testid="sprite-renderer"]')
})`);

exports.runCausalLife = async ({ win, evaluate, until, sleep, record, output, profile, inputs, fixture }) => {
  const started = performance.now();
  const probe = fixture.installLifeProvider();
  const capture = async name => {
    const frame = await win.webContents.capturePage(); assert.equal(frame.isEmpty(), false);
    fs.writeFileSync(path.join(output, name), frame.toPNG());
  };
  try {
    win.focus(); win.webContents.focus();
    await until(() => evaluate('document.hasFocus()'), 'Causal own-window focus');
    const first = await evaluate(`new Promise(resolve=>{const off=window.wispAPI.onBrainState(s=>{queueMicrotask(()=>off());resolve(s);});})`);
    inputs.observe(first);
    await evaluate(`window.wispAPI.setQuietMode({enabled:false})`);
    inputs.follow();
    await evaluate(`window.wispAPI.setAutonomyEnabled({enabled:true})`);
    await until(() => inputs.latest()?.activity?.activityId === 'cursor_interest', 'Actual native cursor activity', 15000);
    const game = inputs.latest().activity;
    inputs.move(48);
    await until(() => inputs.latest()?.activity?.runId === game.runId && inputs.latest().sampledAtMs - game.startedAtMs >= 1050,
      'Observed cursor game execution >=1s', 5000);
    const during = { activity: inputs.latest().activity, visual: inputs.latest().visualIntent, cursor: inputs.latest().cursorGame, rendered: await visibleProof(evaluate) };
    await capture('causal-cursor-running.png');
    await evaluate(`document.querySelector('.wisp-character-root').click()`);
    inputs.park();
    await until(() => fixture.readLifeEvidence(profile).episodes.some(row => row.activityRunId === game.runId && row.cause === 'user_interrupted'),
      'Actual interrupted cursor episode persisted', 5000);
    const event = fixture.readLifeEvidence(profile).episodes.find(row => row.activityRunId === game.runId);
    assert.equal(event.outcome, 'cancelled'); assert.equal(event.source, 'user'); assert.ok(event.executedMs >= 1000);
    await evaluate(`window.wispAPI.setAutonomyEnabled({enabled:false})`);
    const interrupted = { activity: inputs.latest().activity, visual: inputs.latest().visualIntent, rendered: await visibleProof(evaluate) };
    await capture('causal-interrupted.png');
    // The accepted click owns its P2 reaction. Ask only after that real finite
    // reaction settles; a causal dialogue must not displace its protected body.
    let settledEpisode = null; let settledSince = 0;
    await until(() => {
      const latest = inputs.latest();
      if (latest?.activity !== null || latest?.visualIntent.kind !== 'idle_blink') { settledEpisode = null; return false; }
      if (settledEpisode !== latest.visualIntent.episodeId) { settledEpisode = latest.visualIntent.episodeId; settledSince = performance.now(); }
      return performance.now() - settledSince >= 250;
    }, 'Accepted click reaction settled with stable idle episode', 5000);
    await evaluate(`if(!document.querySelector('.chat-input-field')) document.querySelector('.pet-label').click()`);
    await until(() => evaluate(`!!document.querySelector('.chat-input-field')`), 'Causal composer');
    await evaluate(`document.querySelector('.chat-input-field').focus()`); await win.webContents.insertText('Что случилось?');
    await evaluate(`document.querySelector('.chat-input-form').requestSubmit()`);
    await until(() => probe.requests.some(request => request.activity === 'cursor_game' && request.cause === 'user_interrupted' && request.emotion === 'irritated'), 'Actual causal Director projection reaches fake provider', 5000);
    await until(() => inputs.latest()?.dialogue.turn.phase === 'completed', 'Causal native reply completed', 5000);
    const reply = inputs.latest().dialogue.turn;
    assert.equal(reply.replyText, 'Я хотела ещё поиграть. Мне нужна минутка.');
    await until(async () => (await visibleProof(evaluate)).frames.some(source => /pout/u.test(source)), 'Reply has matching pout face', 5000);
    const expressed = { visual: inputs.latest().visualIntent, rendered: await visibleProof(evaluate), outcome: reply.outcome };
    await capture('causal-dialogue.png');
    const after = fixture.readLifeEvidence(profile);
    assert.equal(after.episodes.filter(row => row.activityRunId === game.runId).length, 1);
    if (await evaluate(`!!document.querySelector('.chat-cancel-btn')`)) await evaluate(`document.querySelector('.chat-cancel-btn').click()`);
    await evaluate(`window.wispAPI.setAutonomyEnabled({enabled:true})`);
    await until(() => inputs.latest()?.activity && inputs.latest().activity.runId !== game.runId, 'Next real local activity after interruption', 15000);
    const next = { activity: inputs.latest().activity, visual: inputs.latest().visualIntent };
    record('causal-life-native-cursor-story', 'PASS', 'Actual Main cursor run and injected click → one SQLite interruption → Director context → controlled fake reply + ready pout face → next real local activity');
    return { elapsedMs: performance.now() - started, seeded: 'initial checkpoint only', injected: ['global cursor coordinates', 'fresh-active system idle', 'DOM click/composer'],
      actual: ['Main activity/terminal', 'causal SQLite episode', 'Director semantic capture', 'preload/Renderer', 'ready sprite/pout layers', 'next local activity'],
      during, event, interrupted, providerProjections: probe.requests, expressed, next,
      limitations: ['Synthetic sensor inputs are not physical pointer capture or real human attention.', 'Fixed fake wording is not live LLM quality.', 'Windows/macOS, compositor transparency and emotional voice/rig are NOT RUN.'] };
  } catch(error) {
    fs.writeFileSync(path.join(output,'causal-diagnostic.json'),JSON.stringify({ rendered:await visibleProof(evaluate),trace:inputs.trace(),latest:inputs.latest() && { activity:inputs.latest().activity,motion:inputs.latest().motion,visual:inputs.latest().visualIntent,needs:inputs.latest().character.needs,autonomy:inputs.latest().autonomy,cursor:inputs.latest().globalCursor } },null,2));
    throw error;
  } finally { inputs.park(); probe.dispose(); }
};
