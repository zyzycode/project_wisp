/** Fixed, bundled source. Arguments/stdin contain numeric data, never executable text. */
export const WINDOW_SURFACES_HELPER_PS1 = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WispWindowSurfaces {
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] struct MSG {
        public IntPtr hwnd; public uint message; public UIntPtr wParam; public IntPtr lParam;
        public uint time; public POINT point; public uint privateValue;
    }
    delegate bool EnumProc(IntPtr hwnd, IntPtr value);
    delegate void EventProc(IntPtr hook, uint kind, IntPtr hwnd, int objectId, int childId, uint thread, uint time);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback, IntPtr value);
    [DllImport("user32.dll")] static extern IntPtr GetTopWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr hwnd, uint command);
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr hwnd, uint flags);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int maximum);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLong64(IntPtr hwnd, int index);
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int Frame(IntPtr hwnd, int attr, out RECT rect, int size);
    [DllImport("dwmapi.dll", EntryPoint="DwmGetWindowAttribute")] static extern int Cloaked(IntPtr hwnd, int attr, out int value, int size);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int x1, int y1, int x2, int y2);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr handle);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint minimum, uint maximum, IntPtr dll, EventProc callback, uint process, uint thread, uint flags);
    [DllImport("user32.dll")] static extern bool UnhookWinEvent(IntPtr hook);
    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG message, IntPtr hwnd, uint minimum, uint maximum, uint flags);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG message);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG message);
    [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);

    static readonly Dictionary<IntPtr, string> Tokens = new Dictionary<IntPtr, string>();
    static readonly ConcurrentQueue<string> Requests = new ConcurrentQueue<string>();
    static readonly EventProc Callback = OnEvent; // Root the delegate for the whole native hook lifetime.
    static volatile bool Ended;
    static volatile bool Broken;
    static long LifecycleVersion;
    static readonly HashSet<string> ExcludedClasses = new HashSet<string>(StringComparer.Ordinal) {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "#32768", "tooltips_class32", "#32770"
    };
    static void OnEvent(IntPtr hook, uint kind, IntPtr hwnd, int objectId, int childId, uint thread, uint time) {
        if (hwnd == IntPtr.Zero || objectId != 0 || childId != 0) return;
        if (kind == 0x8000 || kind == 0x8001 || kind == 0x8003 || kind == 0x0016) {
            Tokens.Remove(hwnd); LifecycleVersion++;
        }
    }
    static void Pump() {
        MSG message;
        int count = 0;
        while (PeekMessage(out message, IntPtr.Zero, 0, 0, 1)) {
            if (++count > 10000) throw new Exception("Event continuity unavailable");
            TranslateMessage(ref message); DispatchMessage(ref message);
        }
    }
    static uint Style(IntPtr hwnd, int index) {
        return unchecked((uint)(IntPtr.Size == 8 ? GetWindowLong64(hwnd, index).ToInt64() : GetWindowLong32(hwnd, index)));
    }
    static bool CoversTop(RECT a, RECT b) { return a.L <= b.R && a.R >= b.L && a.T <= b.T && a.B >= b.T; }
    static bool CoversSide(RECT a, RECT b, int x) { return a.L <= x && a.R >= x && a.T <= b.B && a.B >= b.T; }
    static string Sample(string request) {
        string[] parts = request.Split(' ');
        long requestId;
        if (parts.Length != 2 || !long.TryParse(parts[0], out requestId) || requestId <= 0) throw new Exception("Invalid request");
        var own = new HashSet<uint>();
        own.Add((uint)Process.GetCurrentProcess().Id);
        string[] ids = parts[1].Split(',');
        if (ids.Length > 512) throw new Exception("Invalid request");
        foreach (string id in ids) { uint pid; if (!uint.TryParse(id, out pid) || pid == 0) throw new Exception("Invalid request"); own.Add(pid); }
        var enumerated = new HashSet<IntPtr>();
        if (!EnumWindows(delegate(IntPtr hwnd, IntPtr unused) { enumerated.Add(hwnd); return enumerated.Count <= 4096; }, IntPtr.Zero)) throw new Exception("Enumeration unavailable");
        var above = new List<RECT>();
        var accepted = new HashSet<IntPtr>();
        var visited = new HashSet<IntPtr>();
        var rows = new List<string>();
        for (IntPtr hwnd = GetTopWindow(IntPtr.Zero); hwnd != IntPtr.Zero; hwnd = GetWindow(hwnd, 2)) {
            if (!enumerated.Remove(hwnd) || !visited.Add(hwnd) || visited.Count > 4096) throw new Exception("Enumeration changed");
            uint pid;
            if (GetWindowThreadProcessId(hwnd, out pid) == 0) throw new Exception("Window unavailable");
            if (own.Contains(pid) || !IsWindowVisible(hwnd) || IsIconic(hwnd)) continue;
            // Desktop itself does not cover app windows. Shell bars remain occluders.
            if (hwnd == GetDesktopWindow() || hwnd == GetShellWindow()) continue;
            int cloaked;
            if (Cloaked(hwnd, 14, out cloaked, 4) != 0) throw new Exception("Cloaking unavailable");
            if (cloaked != 0) continue;
            RECT frame;
            if (Frame(hwnd, 9, out frame, Marshal.SizeOf(typeof(RECT))) != 0 || frame.R <= frame.L || frame.B <= frame.T) throw new Exception("Frame unavailable");
            var className = new StringBuilder(256);
            if (GetClassName(hwnd, className, className.Capacity) == 0) throw new Exception("Class unavailable");
            uint style = Style(hwnd, -16), extended = Style(hwnd, -20);
            bool candidate = GetAncestor(hwnd, 2) == hwnd && GetWindow(hwnd, 4) == IntPtr.Zero && IsWindowEnabled(hwnd)
                && (style & 0xC0000000u) == 0 && (extended & 0x080800A0u) == 0 && !ExcludedClasses.Contains(className.ToString());
            IntPtr region = CreateRectRgn(0, 0, 0, 0);
            if (region == IntPtr.Zero) throw new Exception("Region unavailable");
            try { if (GetWindowRgn(hwnd, region) != 0) candidate = false; } finally { DeleteObject(region); }
            if (candidate) {
                bool top = true, left = true, right = true;
                foreach (RECT occluder in above) {
                    top &= !CoversTop(occluder, frame);
                    left &= !CoversSide(occluder, frame, frame.L);
                    right &= !CoversSide(occluder, frame, frame.R);
                }
                if (top || left || right) {
                    string token;
                    if (!Tokens.TryGetValue(hwnd, out token)) { token = Guid.NewGuid().ToString("N"); Tokens.Add(hwnd, token); }
                    accepted.Add(hwnd);
                    rows.Add("{\"token\":\"" + token + "\",\"x\":" + frame.L.ToString(CultureInfo.InvariantCulture)
                        + ",\"y\":" + frame.T.ToString(CultureInfo.InvariantCulture) + ",\"width\":" + ((long)frame.R-frame.L).ToString(CultureInfo.InvariantCulture)
                        + ",\"height\":" + ((long)frame.B-frame.T).ToString(CultureInfo.InvariantCulture)
                        + ",\"top\":" + (top ? "true" : "false") + ",\"left\":" + (left ? "true" : "false") + ",\"right\":" + (right ? "true" : "false") + "}");
                    if (rows.Count > 512) throw new Exception("Snapshot too large");
                }
            }
            // Includes visible transient/system/owned windows: they can hide an edge.
            above.Add(frame);
        }
        if (enumerated.Count != 0) throw new Exception("Enumeration changed");
        foreach (IntPtr hwnd in new List<IntPtr>(Tokens.Keys)) if (!accepted.Contains(hwnd)) Tokens.Remove(hwnd);
        return "{\"requestId\":" + requestId.ToString(CultureInfo.InvariantCulture) + ",\"windows\":[" + string.Join(",", rows.ToArray()) + "]}";
    }
    public static void Run() {
        IntPtr dpi = SetThreadDpiAwarenessContext(new IntPtr(-4));
        if (dpi == IntPtr.Zero) throw new Exception("DPI context unavailable");
        IntPtr objects = SetWinEventHook(0x8000, 0x800B, IntPtr.Zero, Callback, 0, 0, 0);
        IntPtr minimize = SetWinEventHook(0x0016, 0x0017, IntPtr.Zero, Callback, 0, 0, 0);
        try {
            if (objects == IntPtr.Zero || minimize == IntPtr.Zero) throw new Exception("Hooks unavailable");
            var reader = new Thread(delegate() {
                try {
                    string line;
                    while ((line = Console.ReadLine()) != null) {
                        if (line.Length > 8192 || Requests.Count >= 4) { Broken = true; break; }
                        Requests.Enqueue(line);
                    }
                } catch { Broken = true; }
                finally { Ended = true; }
            });
            reader.IsBackground = true; reader.Start();
            Console.WriteLine("{\"ready\":true}"); Console.Out.Flush();
            while (!Ended && !Broken) {
                Pump();
                string request;
                if (Requests.TryDequeue(out request)) {
                    long version = LifecycleVersion;
                    string result = Sample(request);
                    Pump();
                    if (version != LifecycleVersion) throw new Exception("Lifecycle changed during snapshot");
                    if (Encoding.UTF8.GetByteCount(result) > 262143) throw new Exception("Snapshot too large");
                    Console.WriteLine(result); Console.Out.Flush();
                }
                Thread.Sleep(2);
            }
        } finally {
            if (objects != IntPtr.Zero) UnhookWinEvent(objects);
            if (minimize != IntPtr.Zero) UnhookWinEvent(minimize);
            SetThreadDpiAwarenessContext(dpi);
        }
    }
}
'@
[WispWindowSurfaces]::Run()
`;
