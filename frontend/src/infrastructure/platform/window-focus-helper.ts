/** Embedded inside the existing fixed C# helper. No executable/user text enters this protocol. */
export const WINDOW_FOCUS_HELPER_CS = String.raw`
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    sealed class FocusWindow {
        public IntPtr Handle; public string Token, ClassName; public uint Pid, Thread; public RECT Frame;
    }
    sealed class FocusPreparation {
        public string Attempt, Nonce; public FocusWindow Window; public long Version, Expires;
    }
    static readonly Dictionary<string, FocusWindow> FocusWindows = new Dictionary<string, FocusWindow>();
    static HashSet<uint> FocusOwn = new HashSet<uint>();
    static FocusPreparation PreparedFocus;
    static long FocusClock() { return Stopwatch.GetTimestamp() * 1000 / Stopwatch.Frequency; }
    static void TrackFocus(IntPtr hwnd, string token, uint pid, RECT frame, string className) {
        uint actualPid; uint thread = GetWindowThreadProcessId(hwnd, out actualPid);
        if (thread == 0 || actualPid != pid) throw new Exception("Window continuity unavailable");
        FocusWindows[token] = new FocusWindow { Handle = hwnd, Token = token, Pid = pid, Thread = thread, Frame = frame, ClassName = className };
    }
    static bool FocusValid(FocusWindow w) {
        Pump(); string token; uint pid;
        if (w == null || !Tokens.TryGetValue(w.Handle, out token) || token != w.Token || !IsWindow(w.Handle)
            || !IsWindowVisible(w.Handle) || !IsWindowEnabled(w.Handle) || IsIconic(w.Handle)
            || GetAncestor(w.Handle, 2) != w.Handle || GetWindow(w.Handle, 4) != IntPtr.Zero
            || GetWindowThreadProcessId(w.Handle, out pid) != w.Thread || pid != w.Pid || FocusOwn.Contains(pid)) return false;
        var name = new StringBuilder(256); RECT frame; int cloaked;
        if (GetClassName(w.Handle, name, 256) == 0 || name.ToString() != w.ClassName || ExcludedClasses.Contains(name.ToString())
            || (Style(w.Handle, -16) & 0xC0000000u) != 0 || (Style(w.Handle, -20) & 0x080800A0u) != 0
            || Cloaked(w.Handle, 14, out cloaked, 4) != 0 || cloaked != 0
            || Frame(w.Handle, 9, out frame, Marshal.SizeOf(typeof(RECT))) != 0) return false;
        return frame.L == w.Frame.L && frame.T == w.Frame.T && frame.R == w.Frame.R && frame.B == w.Frame.B;
    }
    static string FocusResult(long id, string action, string status, string field, string value) {
        return "{\"requestId\":" + id.ToString(CultureInfo.InvariantCulture) + ",\"action\":\"" + action
            + "\",\"status\":\"" + status + "\"" + (field == null ? "" : ",\"" + field + "\":\"" + value + "\"") + "}";
    }
    static bool FocusId(string value) {
        if (value.Length != 32) return false;
        foreach (char c in value) if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
        return true;
    }
    static string FocusAction(string request) {
        string[] p = request.Split(' '); long id;
        if (p.Length < 2 || !long.TryParse(p[1], out id) || id <= 0) throw new Exception("Invalid action");
        if (p[0] == "P") {
            PreparedFocus = null;
            long x, y, width, height; FocusWindow w;
            if (p.Length != 8 || !FocusId(p[2]) || !FocusId(p[3]) || !long.TryParse(p[4], out x)
                || !long.TryParse(p[5], out y) || !long.TryParse(p[6], out width) || !long.TryParse(p[7], out height)) throw new Exception("Invalid preparation");
            if (!FocusWindows.TryGetValue(p[3], out w) || !FocusValid(w)) return FocusResult(id, "prepare", "rejected", "reason", "target_lost");
            if (w.Frame.L != x || w.Frame.T != y || (long)w.Frame.R-w.Frame.L != width || (long)w.Frame.B-w.Frame.T != height)
                return FocusResult(id, "prepare", "rejected", "reason", "target_changed");
            long version = LifecycleVersion; Pump();
            if (version != LifecycleVersion || !FocusValid(w)) return FocusResult(id, "prepare", "rejected", "reason", "target_changed");
            PreparedFocus = new FocusPreparation { Attempt = p[2], Nonce = Guid.NewGuid().ToString("N"), Window = w, Version = version, Expires = FocusClock() + 500 };
            return FocusResult(id, "prepare", "prepared", "preparedId", PreparedFocus.Nonce);
        }
        if (p[0] != "C" || p.Length != 5 || !FocusId(p[2]) || !FocusId(p[3]) || !FocusId(p[4])) throw new Exception("Invalid commit");
        FocusPreparation prepared = PreparedFocus;
        PreparedFocus = null; // Consume before any irreversible call, including denied attempts.
        if (prepared == null || prepared.Attempt != p[2] || prepared.Nonce != p[3] || prepared.Window.Token != p[4])
            return FocusResult(id, "commit", "rejected", "reason", "duplicate");
        if (FocusClock() >= prepared.Expires) return FocusResult(id, "commit", "rejected", "reason", "expired");
        Pump();
        if (prepared.Version != LifecycleVersion || !FocusValid(prepared.Window)) return FocusResult(id, "commit", "rejected", "reason", "target_changed");
        bool already = GetForegroundWindow() == prepared.Window.Handle;
        bool accepted = already || SetForegroundWindow(prepared.Window.Handle); // Exactly one attempt; no bypass or retry.
        Pump();
        if (prepared.Version != LifecycleVersion || !FocusValid(prepared.Window)) return FocusResult(id, "commit", "unknown", "reason", "target_changed_after_dispatch");
        IntPtr foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return FocusResult(id, "commit", "unknown", "reason", "verification_unavailable");
        if (foreground == prepared.Window.Handle) return FocusResult(id, "commit", "success", "effect", already ? "already_foreground" : "focus_observed");
        return accepted ? FocusResult(id, "commit", "unknown", "reason", "verification_unavailable") : FocusResult(id, "commit", "rejected", "reason", "os_denied");
    }
`;
