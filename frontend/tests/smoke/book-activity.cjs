const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Actual Main, real elapsed timers and canonical terminal rows. The only seeded
// data are explicitly reported initial Needs; no activity/terminal is injected.
exports.runBookActivity = async ({ win, evaluate, until, sleep, record, output,
  profile, inputs, fixture, caseName = 'completed' }) => {
  assert.ok(['completed', 'interrupted'].includes(caseName));
  const started = performance.now();
  const frames = [];
  inputs.park();
  await evaluate(`(() => {
    window.__bookSmoke = { latest:null, phases:[], speeches:[] };
    window.__bookSmokeOff = window.wispAPI.onBrainState(snapshot => {
      const state=window.__bookSmoke; state.latest=snapshot;
      if(snapshot.activity?.activityId==='book') {
        const entry={runId:snapshot.activity.runId,phase:snapshot.activity.phaseId,
          startedAtMs:snapshot.activity.startedAtMs,sampledAtMs:snapshot.sampledAtMs,
          visualKind:snapshot.visualIntent.kind,propHint:snapshot.visualIntent.propHint};
        const previous=state.phases.at(-1);
        if(!previous||previous.runId!==entry.runId||previous.phase!==entry.phase) {
          state.phases.push(entry);if(state.phases.length>30)state.phases.shift();
        }
        const text=document.querySelector('.speech-text')?.textContent;
        if(text&&!state.speeches.includes(text))state.speeches.push(text);
      }
    });
  })()`);
  const state = () => evaluate('window.__bookSmoke');
  const screenshot = async label => {
    await evaluate('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    const frame = await win.webContents.capturePage();
    assert.equal(frame.isEmpty(), false);
    const filename = `book-${label}.png`;
    fs.writeFileSync(path.join(output, filename), frame.toPNG());
    frames.push(filename);
  };
  const bookRows = () => fixture.readLifeEvidence(profile).episodes.filter(episode => episode.activity === 'book');
  let fallbackBody;
  const evidence = (observed, completed, interrupted) => {
    assert.ok(observed.speeches.every(text => !/дочитал|прочитал|узнал|страниц|прочтени|learned|pages|finished reading/iu.test(text)), 'Observed local book text cannot claim reading knowledge');
    return { caseName, realElapsedMs: performance.now() - started, phases: observed.phases,
      completed, interrupted, frames, fallbackBody,
      availableArt: 'ready sit/idle; no human book/hand prop',
      input: caseName === 'interrupted'
        ? 'synthetic PointerEvent through actual Renderer/Main; not physical OS pointer'
        : 'synthetic external cursor/idle sources; no interruption input',
      limitations: ['No text/pages/content were read.', 'No live LLM/voice quality claim.',
        'Full visible book rendering still requires human-authored assets.', 'Windows/macOS/DPI transitions NOT RUN.'] };
  };
  let dragging = false;
  try {
    const existingRuns = new Set(bookRows().map(episode => episode.activityRunId));
    await evaluate('window.wispAPI.setAutonomyEnabled({enabled:true})');
    await until(async () => {
      const lost = bookRows().find(episode => !existingRuns.has(episode.activityRunId)
        && episode.cause === 'environment_lost' && episode.executedMs < 100);
      if (lost) throw new Error('Actual book run immediately lost its environment before a visible phase');
      return (await state()).latest?.activity?.activityId === 'book';
    }, 'Actual Utility book start', 95_000);
    const firstRun = (await state()).latest.activity.runId;
    await until(async () => { const activity = (await state()).latest?.activity;
      return activity?.runId === firstRun && activity.phaseId === 'with_book'; }, 'Actual with-book phase');
    assert.equal(await evaluate("Boolean(document.querySelector('[data-layer-id=\"prop_book\"]'))"), false);
    fallbackBody = await evaluate("document.querySelector('[data-layer-id=\"base_body\"]')?.getAttribute('data-frame-source')");
    assert.ok(typeof fallbackBody === 'string' && /body\/(?:sit|idle)\//u.test(fallbackBody), 'Ready sit/idle fallback must be rendered');
    await screenshot('with-book-fallback');
    const interruptedRun = firstRun;
    if (caseName !== 'interrupted') {
      await until(() => bookRows().some(episode => episode.activityRunId === firstRun && episode.cause === 'completed'), 'Persisted real completed book', 20_000);
      const rows = bookRows().filter(episode => episode.activityRunId === firstRun);
      assert.equal(rows.length, 1); const completed = rows[0];
      assert.ok(completed.executedMs >= 14_000 && completed.executedMs < 16_000);
      assert.equal(completed.source, 'autonomy');
      assert.equal(completed.participation, 'solitary');
      const firstPhases = (await state()).phases.filter(entry => entry.runId === firstRun).map(entry => entry.phase);
      assert.deepEqual(firstPhases, ['settle', 'with_book', 'finish']);
      record('book-completed-native', 'PASS', 'Actual Utility run traversed all phases on real timers and persisted exactly one completed solitary terminal');
      return evidence(await state(), completed, null);
    }
    await screenshot('before-interruption');
    await evaluate(`(() => {
      const target=document.querySelector('.wisp-character-root');
      const r=target.getBoundingClientRect();
      const x=window.screenX+r.x+r.width/2,y=window.screenY+r.y+r.height/2;
      window.__bookDrag={x,y};
      target.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:51,button:0,buttons:1,screenX:x,screenY:y}));
      window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:51,buttons:1,screenX:x+24,screenY:y}));
    })()`);
    dragging = true;
    await until(() => evaluate('Boolean(document.querySelector(".pet-container.is-dragging"))'), 'Accepted native renderer drag');
    await until(() => bookRows().some(episode => episode.activityRunId === interruptedRun), 'Persisted actual interrupted book');
    const interrupted = bookRows().filter(episode => episode.activityRunId === interruptedRun);
    assert.equal(interrupted.length, 1);
    assert.equal(interrupted[0].cause, 'user_interrupted');
    assert.equal(interrupted[0].source, 'user');
    assert.equal(interrupted[0].outcome, 'cancelled');
    assert.ok(interrupted[0].triggerSequence !== null);
    assert.ok(interrupted[0].executedMs < 14_000);
    await until(async () => { const snapshot = (await state()).latest;
      return snapshot?.activity?.runId !== interruptedRun
        && !snapshot?.visualIntent?.kind?.startsWith('book_'); }, 'Book visual and activity cleanup');
    assert.equal(await evaluate("Boolean(document.querySelector('[data-layer-id=\"prop_book\"]'))"), false);
    await screenshot('interrupted-cleanup');
    await evaluate(`window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:51,button:0,screenX:window.__bookDrag.x+24,screenY:window.__bookDrag.y}))`);
    dragging = false;
    await until(() => evaluate('!document.querySelector(".pet-container.is-dragging")'), 'Book interruption drag released');
    await sleep(150);
    assert.equal(bookRows().filter(episode => episode.activityRunId === interruptedRun).length, 1);
    assert.notEqual((await state()).latest?.activity?.runId, interruptedRun);
    const observed = await state();
    record('book-interrupted-native-cleanup', 'PASS', 'Accepted injected renderer drag produced one user-interrupted terminal and removed the old phase/prop without restart');
    return evidence(observed, null, interrupted[0]);
  } catch (error) {
    const observed = await state().catch(() => null);
    fs.writeFileSync(path.join(output, 'book-diagnostic.json'), JSON.stringify({
      caseName, realElapsedMs: performance.now() - started,
      episodes: bookRows(),
      phases: observed?.phases ?? [], latest: observed?.latest ? {
        activity: observed.latest.activity, motion: observed.latest.motion,
        visual: observed.latest.visualIntent, needs: observed.latest.character.needs,
      } : null,
    }, null, 2));
    throw error;
  } finally {
    if (dragging) await evaluate(`window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:51,button:0,screenX:window.__bookDrag.x+24,screenY:window.__bookDrag.y}))`).catch(() => undefined);
    await evaluate('window.__bookSmokeOff?.();delete window.__bookSmokeOff;delete window.__bookSmoke;delete window.__bookDrag;').catch(() => undefined);
    await evaluate('window.wispAPI.setAutonomyEnabled({enabled:false})').catch(() => undefined);
  }
};
