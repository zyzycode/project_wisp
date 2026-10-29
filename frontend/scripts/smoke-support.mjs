import { spawnSync } from 'node:child_process';

export function smokeEnvironment(env, profile, output) {
  const clean = Object.fromEntries(Object.entries(env).filter(([key]) =>
    !/^(WISP_|VITE_|ELECTRON_|REMOTE_DEBUGGING_PORT$)/i.test(key)
    && !/(API_KEY|TOKEN_API|ASSISTANTS_JSON)/i.test(key)));
  return { ...clean, WISP_SMOKE_PROFILE: profile, WISP_SMOKE_OUTPUT: output,
    WISP_AI_EVENTS_ENABLED: 'false', WISP_SUMMARY_ENABLED: 'false' };
}

export function bounded(promise, milliseconds, label, signal) {
  let timer;
  let onAbort;
  return Promise.race([promise, new Promise((_, reject) => {
    onAbort = () => reject(new Error(`${label} aborted`));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), milliseconds);
  })]).finally(() => { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); });
}

export function stopOwnedProcess(child, signal = 'SIGTERM') {
  if (!child?.pid) return;
  if (process.platform === 'win32') {
    if (child.exitCode === null) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore', timeout: 5000 });
  } else {
    try { process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
}

export function exitStatus(report, code) {
  return code === 0 && report?.checks?.length > 0
    && report.checks.every(check => check.status !== 'FAIL')
    && report.checks.some(check => check.name === 'application-quit' && check.status === 'PASS') ? 0 : 1;
}
