import { describe, expect, it } from 'vitest';
import { parseObservationResponse, safeObservationText } from '../../src/infrastructure/platform/active-application-protocol';
import { ObservationExecutableRegistry } from '../../src/infrastructure/platform/active-application-management';
import { ACTIVE_APPLICATION_HELPER_PS1 } from '../../src/infrastructure/platform/active-application-helper';

const entry = { appKey: 'key', path: 'C:\\Tools\\Editor.exe', category: 'editor', excluded: false } as const;
const message = { id: 1, available: true, appKey: 'key', episodeToken: 'episode', sourceToken: 'source', appName: 'Editor', windowTitle: '' };
describe('observation protocol and private executable registry', () => {
  it('accepts exact semantic samples including empty captions and rejects exclusions before use', () => {
    expect(parseObservationResponse(message, 1, [entry])).toEqual(message);
    expect(() => parseObservationResponse(message, 1, [{ ...entry, excluded: true }])).toThrow();
    expect(() => parseObservationResponse({ ...message, hwnd: 'secret' }, 1, [entry])).toThrow();
  });
  it('cleans controls/bidi/lone surrogates and preserves scalar boundaries', () => {
    expect(safeObservationText(' \u0000x\u0085\u061c\u200f\u202e\u2069\ud800y\udfff ', 80)).toBe('xy');
    expect(safeObservationText(`${'x'.repeat(159)}😀`, 160)).toBe('x'.repeat(159));
    expect(() => parseObservationResponse({ ...message, windowTitle: '\ud800' }, 1, [entry])).toThrow();
    expect(() => parseObservationResponse({ ...message, appName: 'x'.repeat(81) }, 1, [entry])).toThrow();
    expect(() => parseObservationResponse({ ...message, sourceToken: 'a/b' }, 1, [entry])).toThrow();
  });
  it('keeps canonical paths private, exact case insensitive identity stable and supports exclusions', () => {
    const registry = new ObservationExecutableRegistry(name => name, () => 'random-key');
    const app = registry.registerExecutable('C:\\Tools\\Editor.exe');
    expect(app).toEqual({ appKey: 'random-key', alias: 'Editor', category: 'unknown', excluded: false });
    expect(registry.registerExecutable('c:\\TOOLS\\editor.EXE')).toBe(app);
    expect(registry.resolvePolicy({ generation: 1, active: true, applications: [{ ...app, excluded: true }] })).toEqual([
      { appKey: 'random-key', path: 'C:\\Tools\\Editor.exe', category: 'unknown', excluded: true },
    ]);
    registry.forgetExecutable(app.appKey);
    expect(() => registry.resolvePolicy({ generation: 1, active: true, applications: [app] })).toThrow();
  });
  it('normalizes Windows canonical namespaces without changing exact matching', () => {
    const registry = new ObservationExecutableRegistry(() => '\\\\?\\UNC\\server\\share\\editor.exe', () => 'key');
    const app = registry.registerExecutable('C:\\alias.exe');
    expect(registry.resolvePolicy({ generation: 1, active: true, applications: [app] })[0]?.path).toBe('\\\\server\\share\\editor.exe');
  });
  it('enforces combined 32 entries and path bounds before mutation', () => {
    let index = 0;
    const registry = new ObservationExecutableRegistry(value => value, () => `key-${index++}`);
    for (let i = 0; i < 32; i++) registry.registerExecutable(`C:\\Tools\\${i}.exe`);
    expect(() => registry.registerExecutable('C:\\Tools\\33.exe')).toThrow();
    expect(() => registry.registerExecutable('relative.exe')).toThrow();
    expect(() => registry.registerExecutable(`C:\\${'x'.repeat(1024)}.exe`)).toThrow();
    expect(() => registry.registerExecutable('C:\\Tools\\file.txt')).toThrow();
    expect(registry.registerExecutable('c:\\TOOLS\\0.exe').appKey).toBe('key-0');
    registry.clearExecutables(); expect(registry.registerExecutable('C:\\Tools\\33.exe').appKey).toBe('key-32');
  });
  it('retains native identity/title controls entirely in fixed helper source', () => {
    // Structural guard for privileged source; actual Win32 execution requires opt-in Windows smoke.
    expect(ACTIVE_APPLICATION_HELPER_PS1.indexOf('if (allowed < 0)')).toBeLessThan(ACTIVE_APPLICATION_HELPER_PS1.indexOf('int length = GetWindowTextLength(window)'));
    expect(ACTIVE_APPLICATION_HELPER_PS1).toContain('if (denied[i]) return Unavailable("excluded")');
    expect(ACTIVE_APPLICATION_HELPER_PS1).toContain('length > 4096');
    expect(ACTIVE_APPLICATION_HELPER_PS1).toContain('afterLength != copied || copied != length');
    expect(ACTIVE_APPLICATION_HELPER_PS1).toContain('created != afterCreated');
    expect(ACTIVE_APPLICATION_HELPER_PS1).toContain('Buffer.BlockCopy(raw.ToCharArray()');
    expect(ACTIVE_APPLICATION_HELPER_PS1).toContain('if (LastHash != hash) Source = Guid.NewGuid()');
    expect(ACTIVE_APPLICATION_HELPER_PS1).not.toContain('Invoke-Expression');
  });
});
