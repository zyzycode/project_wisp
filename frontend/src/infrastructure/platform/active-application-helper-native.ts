/** Read-only P/Invoke; all HWND/PID/process creation identities remain inside this helper. */
export const ACTIVE_APPLICATION_NATIVE = String.raw`
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
public sealed class WispObservationResult {
    public bool available;
    public string reason, appKey, episodeToken, sourceToken, appName, windowTitle;
}
public static class WispActiveApplication {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetShellWindow();
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder text, int size);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern int GetWindowText(IntPtr h, StringBuilder text, int size);
    [DllImport("user32.dll", SetLastError=true)] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr h);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetUserObjectInformation(IntPtr h, int index, StringBuilder text, uint size, out uint needed);
    [DllImport("kernel32.dll", SetLastError=true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool QueryFullProcessImageName(IntPtr h, uint flags, StringBuilder path, ref uint size);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr h, out long created, out long exited, out long kernel, out long user);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string path, uint access, uint share, IntPtr security, uint mode, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetFinalPathNameByHandle(IntPtr h, StringBuilder path, uint size, uint flags);
    [DllImport("kernel32.dll")] static extern void SetLastError(uint error);
    static IntPtr LastWindow;
    static uint LastPid;
    static long LastCreated;
    static string Episode, Source, LastHash;
    static readonly HashSet<string> BlockedNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "explorer.exe", "dwm.exe", "winlogon.exe", "logonui.exe", "consent.exe", "credentialuibroker.exe",
        "shellexperiencehost.exe", "startmenuexperiencehost.exe", "searchhost.exe", "applicationframehost.exe",
        "powershell.exe", "pwsh.exe", "wisp.exe", "project wisp.exe", "electron.exe",
        "csrss.exe", "smss.exe", "services.exe", "lsass.exe", "svchost.exe", "wininit.exe", "systemsettings.exe"
    };
    static readonly HashSet<string> BlockedClasses = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
        "Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd", "#32768", "tooltips_class32"
    };
    static WispObservationResult Unavailable(string reason) {
        LastWindow = IntPtr.Zero; LastHash = null; Episode = null; Source = null;
        return new WispObservationResult { available = false, reason = reason };
    }
    static bool NormalDesktop() {
        IntPtr desktop = OpenInputDesktop(0, false, 1);
        if (desktop == IntPtr.Zero) return false;
        try {
            uint needed; StringBuilder name = new StringBuilder(256);
            return GetUserObjectInformation(desktop, 2, name, 512, out needed) && name.ToString() == "Default";
        } finally { CloseDesktop(desktop); }
    }
    static string Canonical(string path) {
        IntPtr file = CreateFile(path, 0, 7, IntPtr.Zero, 3, 0, IntPtr.Zero);
        if (file == new IntPtr(-1)) return null;
        try {
            StringBuilder result = new StringBuilder(32768);
            uint length = GetFinalPathNameByHandle(file, result, 32768, 0);
            if (length == 0 || length >= 32768) return null;
            string value = result.ToString();
            if (value.StartsWith(@"\\?\UNC\", StringComparison.OrdinalIgnoreCase)) value = @"\\" + value.Substring(8);
            else if (value.StartsWith(@"\\?\", StringComparison.Ordinal)) value = value.Substring(4);
            return value.Length <= 1024 ? value : null;
        } finally { CloseHandle(file); }
    }
    static bool Identity(IntPtr window, out uint pid, out long created, out string path) {
        created = 0; path = null; GetWindowThreadProcessId(window, out pid);
        if (pid == 0) return false;
        IntPtr process = OpenProcess(0x1000, false, pid);
        if (process == IntPtr.Zero) return false;
        try {
            long exited, kernel, user; uint size = 32768; StringBuilder name = new StringBuilder(32768);
            if (!GetProcessTimes(process, out created, out exited, out kernel, out user) || exited != 0 ||
                !QueryFullProcessImageName(process, 0, name, ref size)) return false;
            path = Canonical(name.ToString()); return path != null;
        } finally { CloseHandle(process); }
    }
    static string Clean(string raw, int maximum) {
        StringBuilder clean = new StringBuilder();
        for (int i = 0; i < raw.Length; i++) {
            char c = raw[i];
            if (c <= 31 || (c >= 127 && c <= 159) || c == 0x61c || c == 0x200e || c == 0x200f ||
                (c >= 0x202a && c <= 0x202e) || (c >= 0x2066 && c <= 0x2069)) continue;
            if (char.IsHighSurrogate(c)) {
                if (i + 1 < raw.Length && char.IsLowSurrogate(raw[i + 1])) { clean.Append(c); clean.Append(raw[++i]); }
            } else if (!char.IsLowSurrogate(c)) clean.Append(c);
        }
        string value = clean.ToString().Trim();
        if (value.Length <= maximum) return value;
        int end = maximum; if (char.IsHighSurrogate(value[end - 1])) end--;
        return value.Substring(0, end).Trim();
    }
    public static WispObservationResult Read(string[] keys, string[] paths, bool[] denied, uint[] ownIds) {
        try {
            if (!NormalDesktop()) return Unavailable("permission_denied");
            IntPtr window = GetForegroundWindow();
            if (window == IntPtr.Zero || window == GetShellWindow() || window == GetDesktopWindow() ||
                GetAncestor(window, 2) != window || !IsWindowVisible(window)) return Unavailable("excluded");
            uint pid; long created; string path;
            if (!Identity(window, out pid, out created, out path)) return Unavailable("permission_denied");
            if (Array.IndexOf(ownIds, pid) >= 0 || BlockedNames.Contains(Path.GetFileName(path))) return Unavailable("excluded");
            StringBuilder cls = new StringBuilder(256);
            if (GetClassName(window, cls, 256) == 0) return Unavailable("permission_denied");
            if (BlockedClasses.Contains(cls.ToString())) return Unavailable("excluded");
            int allowed = -1;
            for (int i = 0; i < paths.Length; i++) {
                if (!String.Equals(path, paths[i], StringComparison.OrdinalIgnoreCase)) continue;
                if (denied[i]) return Unavailable("excluded");
                allowed = i;
            }
            if (allowed < 0) return Unavailable("excluded");
            // No title API occurs until exact canonical identity and all exclusions pass.
            if (GetForegroundWindow() != window) return Unavailable("excluded");
            SetLastError(0); int length = GetWindowTextLength(window);
            if (Marshal.GetLastWin32Error() != 0 || length > 4096) return Unavailable("permission_denied");
            StringBuilder caption = new StringBuilder(4098);
            SetLastError(0); int copied = GetWindowText(window, caption, 4098);
            if (Marshal.GetLastWin32Error() != 0 || copied > 4096) return Unavailable("permission_denied");
            SetLastError(0); int afterLength = GetWindowTextLength(window);
            if (Marshal.GetLastWin32Error() != 0 || afterLength != copied || copied != length) return Unavailable("permission_denied");
            uint afterPid; long afterCreated; string afterPath;
            if (!NormalDesktop() || GetForegroundWindow() != window || !Identity(window, out afterPid, out afterCreated, out afterPath) ||
                pid != afterPid || created != afterCreated || !String.Equals(path, afterPath, StringComparison.OrdinalIgnoreCase)) return Unavailable("excluded");
            string appName = Clean(Path.GetFileNameWithoutExtension(path), 80);
            if (appName.Length == 0) return Unavailable("excluded");
            string raw = caption.ToString(); string hash;
            byte[] rawUnits = new byte[raw.Length * 2]; Buffer.BlockCopy(raw.ToCharArray(), 0, rawUnits, 0, rawUnits.Length);
            using (SHA256 digest = SHA256.Create()) { hash = Convert.ToBase64String(digest.ComputeHash(rawUnits)); }
            if (LastWindow != window || LastPid != pid || LastCreated != created || Episode == null) {
                Episode = Guid.NewGuid().ToString(); LastHash = null;
            }
            if (LastHash != hash) Source = Guid.NewGuid().ToString();
            LastWindow = window; LastPid = pid; LastCreated = created; LastHash = hash;
            return new WispObservationResult { available = true, appKey = keys[allowed], episodeToken = Episode,
                sourceToken = Source, appName = appName, windowTitle = Clean(raw, 160) };
        } catch { return Unavailable("permission_denied"); }
    }
}
`;
