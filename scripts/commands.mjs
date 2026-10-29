import { existsSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function frontendEnvironment(env) {
  // Retired credentials stay blocked so old local environments cannot leak them into desktop.
  const serverOnly = new Set(['GROQ_API_KEY', 'GEMINI_API_KEY', 'OPENAI_API_KEY', 'TOKEN_API', 'ASSISTANTS_JSON',
    'WISP_AI_PROVIDER', 'WISP_AI_MODEL', 'WISP_AI_BASE_URL', 'WISP_AI_MAX_OUTPUT_TOKENS',
    'WISP_AI_TEMPERATURE', 'WISP_AI_THINKING_LEVEL', 'WISP_AI_REQUEST_TIMEOUT',
    'WISP_AI_CONNECT_TIMEOUT', 'WISP_AI_POOL_TIMEOUT', 'WISP_UPSTREAM_TRUST_ENV']);
  return Object.fromEntries(Object.entries(env).filter(([name]) => !serverOnly.has(name.toUpperCase())));
}

export function backendCommand(mode, env = process.env) {
  const cwd = path.join(root, 'backend');
  const python = env.WISP_PYTHON || [
    path.join(cwd, '.venv', 'Scripts', 'python.exe'),
    path.join(cwd, '.venv', 'bin', 'python'),
  ].find(existsSync) || 'python';
  const port = env.WISP_BACKEND_PORT || '8000';
  if (!/^\d+$/u.test(port) || Number(port) < 1 || Number(port) > 65535) {
    throw new Error('WISP_BACKEND_PORT must be a port between 1 and 65535');
  }
  const commands = {
    dev: ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', port],
    test: ['-m', 'pytest', '-q', '-p', 'no:cacheprovider'],
    check: ['-m', 'pip', 'check'],
  };
  if (!Object.hasOwn(commands, mode)) throw new Error(`Unknown backend command: ${mode}`);
  return { name: 'backend', command: python, args: commands[mode], cwd, env };
}

export function devCommands(env = process.env) {
  const cwd = path.join(root, 'frontend');
  const require = createRequire(path.join(cwd, 'package.json'));
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  return [{
    name: 'frontend', command: process.execPath, args: [vite], cwd,
    env: managedDesktopEnvironment(env),
  }];
}

function managedDesktopEnvironment(env) {
  const selected = backendCommand('test', { ...env, WISP_BACKEND_PORT: '8000' }).command;
  const candidates = path.isAbsolute(selected) || selected.includes('/') || selected.includes('\\')
    ? [path.resolve(root, selected)]
    : (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)
      .flatMap(directory => [path.resolve(directory, selected),
        ...(process.platform === 'win32' ? [path.resolve(directory, `${selected}.exe`)] : [])]);
  const python = candidates.find(existsSync);
  const desktopEnv = { ...frontendEnvironment(env),
    WISP_LOCAL_BACKEND_DIR: path.join(root, 'backend'), WISP_AI_EVENTS_ENABLED: 'false' };
  delete desktopEnv.WISP_PYTHON;
  if (python) desktopEnv.WISP_PYTHON = python;
  return desktopEnv;
}

export function frontendCommand(script, args = [], env = process.env) {
  const candidates = [env.npm_execpath];
  for (const directory of (env.PATH || env.Path || '').split(path.delimiter)) {
    if (!directory) continue;
    candidates.push(path.join(directory, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      path.join(directory, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'));
    const npm = path.join(directory, 'npm');
    if (existsSync(npm)) {
      const resolved = realpathSync(npm);
      if (path.basename(resolved) === 'npm-cli.js') candidates.push(resolved);
    }
  }
  const npmCli = candidates.find(candidate => candidate && existsSync(candidate));
  if (!npmCli) throw new Error('npm CLI not found. Add the Node.js/npm installation to PATH.');
  const python = backendCommand('test', env).command;
  const frontendEnv = script === 'dev' ? managedDesktopEnvironment(env)
    : { ...frontendEnvironment(env), WISP_PYTHON: python };
  if (path.isAbsolute(python)) {
    frontendEnv.PATH = `${path.dirname(python)}${path.delimiter}${env.PATH || env.Path || ''}`;
    delete frontendEnv.Path;
  }
  return { name: 'frontend', command: process.execPath,
    args: [npmCli, 'run', script, ...(args.length ? ['--', ...args] : [])],
    cwd: path.join(root, 'frontend'), env: frontendEnv };
}

export function wispCommands(mode, args = [], env = process.env) {
  const tooling = () => ({ name: 'tooling', command: process.execPath,
    args: ['--test', ...readdirSync(path.join(root, 'scripts', 'tests'))
      .filter(name => name.endsWith('.test.mjs')).map(name => path.join(root, 'scripts', 'tests', name))],
    cwd: root, env });
  if (mode === 'dev') return devCommands(env);
  if (mode === 'dev:backend') return [backendCommand('dev', env)];
  if (mode === 'test:backend') return [backendCommand('test', env)];
  if (mode === 'check:backend') return [backendCommand('check', env)];
  if (mode === 'test:tooling') return [tooling()];
  if (mode === 'test') return [tooling(), frontendCommand('test', [], env),
    frontendCommand('test:python', [], env), backendCommand('check', env), backendCommand('test', env)];
  const frontendScripts = { 'dev:frontend': 'dev', 'test:frontend': 'test', 'test:python': 'test:python',
    typecheck: 'typecheck', 'sprites:validate': 'sprites:validate', 'smoke:desktop': 'smoke:desktop' };
  if (Object.hasOwn(frontendScripts, mode)) return [frontendCommand(frontendScripts[mode], args, env)];
  throw new Error(`Unknown Wisp command: ${mode}`);
}
