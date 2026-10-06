import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { WINDOW_SURFACES_HELPER_PS1 } from '../../src/infrastructure/platform/window-surfaces-helper';

describe.skipIf(process.platform !== 'win32')('bundled C# enumeration regression', () => {
  it('keeps missing DWM frames as occluders only and rejects unknown geometry', () => {
    // Execute the actual Sample implementation with deterministic native boundaries.
    const bodies: Readonly<Record<string, string>> = {
      EnumWindows: 'callback(new IntPtr(1), value); callback(new IntPtr(2), value); return true;',
      GetTopWindow: 'return new IntPtr(1);',
      GetWindow: 'return command == 2 && hwnd.ToInt32() == 1 ? new IntPtr(2) : IntPtr.Zero;',
      GetAncestor: 'return hwnd;', IsWindowVisible: 'return true;', IsIconic: 'return false;',
      IsWindowEnabled: 'return true;', GetWindowThreadProcessId: 'pid = 42; return 1;',
      GetClassName: 'name.Append("App"); return 3;', GetWindowLong32: 'return 0;',
      GetWindowLong64: 'return IntPtr.Zero;', GetDesktopWindow: 'return IntPtr.Zero;',
      GetShellWindow: 'return IntPtr.Zero;', Cloaked: 'value = 0; return 0;',
      Frame: 'rect = new RECT { L = 100, T = 100, R = 300, B = 300 }; if (hwnd.ToInt32() == 2 || Mode == 0) return 0; rect = new RECT(); return Mode == 2 ? 0 : -1;',
      GetWindowRect: 'rect = Mode == 4 ? new RECT() : new RECT { L = 90, T = 90, R = 150, B = 110 }; return Mode != 3;',
      CreateRectRgn: 'return new IntPtr(1);', DeleteObject: 'return true;', GetWindowRgn: 'return 0;',
    };
    const source = WINDOW_SURFACES_HELPER_PS1
      .replace(/\[DllImport\([^\n]+\)\] static extern ([^\n]+?) (\w+)\(([^\n]*)\);/g,
        (declaration: string, result: string, name: string, args: string) => bodies[name] === undefined
          ? declaration : `static ${result} ${name}(${args}) { ${bodies[name]} }`)
      .replace('static string Sample(string request)', 'public static int Mode; public static string Sample(string request)')
      .replace('[WispWindowSurfaces]::Run()', `
        [WispWindowSurfaces]::Mode = 0
        [WispWindowSurfaces]::Sample('1 999')
        foreach ($mode in @(1, 2)) {
          [WispWindowSurfaces]::Mode = $mode
          [WispWindowSurfaces]::Sample('2 999')
        }
        [WispWindowSurfaces]::Mode = 4
        [WispWindowSurfaces]::Sample('3 999')
        [WispWindowSurfaces]::Mode = 3
        try { [WispWindowSurfaces]::Sample('3 999'); exit 2 } catch { Write-Output 'unknown-rejected' }
      `);
    const result = spawnSync(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(JSON.parse(lines[0] ?? '{}').windows).toHaveLength(1);
    for (const line of lines.slice(1, 3)) {
      expect(JSON.parse(line).windows).toEqual([expect.objectContaining({ x: 100, y: 100, top: false, left: false, right: true })]);
    }
    expect(JSON.parse(lines[3] ?? '{}').windows).toEqual([expect.objectContaining({ top: true, left: true, right: true })]);
    expect(lines[4]).toBe('unknown-rejected');
  });
});

