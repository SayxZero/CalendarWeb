// wdrive - drives and records the windows of one process without the real
// mouse: clicks and keys are posted to the windows, frames are taken with
// PrintWindow and laid onto a background, so nothing else on the screen
// (other people's windows, the lock screen) ever gets into the video.
//
//   wdrive list <pid>
//   wdrive move <hwnd> x y w h
//   wdrive grab <hwnd> out.png
//   wdrive run script.txt
//
// Script lines: pid N | region x y w h | size W H | fps N | bg file.png |
// ffmpeg path | record out.mp4 | wait ms | point x y [ms] | click x y |
// dclick x y | rclick x y | drag x1 y1 x2 y2 ms | type text | key NAME |
// wheel x y delta | shot out.png | stop | log text.  Coordinates are screen
// pixels; # starts a comment.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

static class Native
{
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
    public delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] public static extern bool ScreenToClient(IntPtr h, ref POINT p);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int index);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int value, int size);
    [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT value, int size);
    [DllImport("user32.dll")] public static extern uint MapVirtualKey(uint code, uint type);
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct CONSOLE_FONT_INFOEX {
        public uint cbSize; public uint nFont; public short X; public short Y; public int FontFamily; public int FontWeight;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string FaceName;
    }
    [DllImport("kernel32.dll")] public static extern bool FreeConsole();
    [DllImport("kernel32.dll")] public static extern bool AttachConsole(uint pid);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateFile(string name, uint access, uint share, IntPtr security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern bool SetCurrentConsoleFontEx(IntPtr output, bool maximum, ref CONSOLE_FONT_INFOEX font);
}

class Win
{
    public IntPtr Handle;
    public Native.RECT Rect;     // GetWindowRect, with the invisible resize border
    public Native.RECT Frame;    // what is actually drawn on the screen
    public bool Layered;
}

static class Program
{
    static uint pid;
    static int rx, ry, rw = 1600, rh = 860, ow = 1280, oh = 688, fps = 20;
    static Bitmap background;
    static string ffmpegPath = @"D:\ffmpeg\bin\ffmpeg.exe";
    static Thread recorder;
    static volatile bool recording;
    static readonly object pointerLock = new object();
    static float px = -1, py = -1;          // pointer, screen coordinates
    static bool pointerOn = true;
    static DateTime rippleAt = DateTime.MinValue;
    static float rippleX, rippleY;
    static IntPtr lastTarget = IntPtr.Zero;
    static Stopwatch clock = new Stopwatch();
    static StreamWriter logFile;

    static int Main(string[] args)
    {
        Native.SetProcessDPIAware();
        if (args.Length == 0) { Console.WriteLine("wdrive list|move|grab|run ..."); return 1; }
        try {
            switch (args[0]) {
            case "list": List(uint.Parse(args[1])); return 0;
            case "move":
                Native.MoveWindow(ParseHandle(args[1]), int.Parse(args[2]), int.Parse(args[3]),
                                  int.Parse(args[4]), int.Parse(args[5]), true);
                return 0;
            case "grab": GrabOne(ParseHandle(args[1]), args[2]); return 0;
            case "run": return Run(args[1]);
            }
        } catch (Exception e) {
            Console.Error.WriteLine(e.ToString());
            return 2;
        }
        return 1;
    }

    static IntPtr ParseHandle(string s)
    {
        if (s.StartsWith("0x")) return new IntPtr(Convert.ToInt64(s.Substring(2), 16));
        return new IntPtr(long.Parse(s));
    }

    // Visible top-level windows of the process, topmost first.
    static List<Win> Windows(uint process)
    {
        var list = new List<Win>();
        Native.EnumWindows(delegate (IntPtr h, IntPtr l) {
            uint owner;
            Native.GetWindowThreadProcessId(h, out owner);
            if (owner != process || !Native.IsWindowVisible(h) || Native.IsIconic(h)) return true;
            int cloaked;
            if (Native.DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return true;
            Native.RECT r;
            Native.GetWindowRect(h, out r);
            if (r.Right - r.Left < 2 || r.Bottom - r.Top < 2) return true;
            var w = new Win();
            w.Handle = h; w.Rect = r; w.Frame = r;
            Native.RECT f;
            if (Native.DwmGetWindowAttribute(h, 9, out f, 16) == 0 && f.Right > f.Left) w.Frame = f;
            w.Layered = (Native.GetWindowLong(h, -20) & 0x80000) != 0;
            list.Add(w);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    static void List(uint process)
    {
        foreach (Win w in Windows(process)) {
            var cls = new StringBuilder(256); Native.GetClassName(w.Handle, cls, 256);
            var title = new StringBuilder(256); Native.GetWindowText(w.Handle, title, 256);
            Console.WriteLine("0x{0:X} {1},{2} {3}x{4} layered={5} class={6} title={7}", w.Handle.ToInt64(),
                w.Frame.Left, w.Frame.Top, w.Frame.Right - w.Frame.Left, w.Frame.Bottom - w.Frame.Top,
                w.Layered, cls, title);
        }
    }

    static Bitmap Print(IntPtr h, Native.RECT r)
    {
        var bmp = new Bitmap(r.Right - r.Left, r.Bottom - r.Top, PixelFormat.Format32bppArgb);
        using (Graphics g = Graphics.FromImage(bmp)) {
            IntPtr dc = g.GetHdc();
            Native.PrintWindow(h, dc, 2);
            g.ReleaseHdc(dc);
        }
        return bmp;
    }

    static void GrabOne(IntPtr h, string file)
    {
        Native.RECT r;
        Native.GetWindowRect(h, out r);
        using (Bitmap b = Print(h, r)) b.Save(file, ImageFormat.Png);
    }

    // ------------------------------------------------------------ frames

    static Bitmap Compose()
    {
        var frame = new Bitmap(ow, oh, PixelFormat.Format32bppArgb);
        float s = (float)ow / rw;
        using (Graphics g = Graphics.FromImage(frame)) {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            g.SmoothingMode = SmoothingMode.AntiAlias;
            if (background != null) {
                // cover the frame, centred
                float k = Math.Max((float)ow / background.Width, (float)oh / background.Height);
                float bw = background.Width * k, bh = background.Height * k;
                g.DrawImage(background, (ow - bw) / 2, (oh - bh) / 2, bw, bh);
            } else {
                g.Clear(Color.FromArgb(17, 26, 34));
            }
            List<Win> wins = Windows(pid);
            wins.Reverse();                 // bottom first
            foreach (Win w in wins) {
                // a window may close between the listing and the print
                try { DrawWindow(g, w, s); } catch (Exception) { }
            }
            float x, y; DateTime ripple; float rxp, ryp; bool on;
            lock (pointerLock) { x = px; y = py; ripple = rippleAt; rxp = rippleX; ryp = rippleY; on = pointerOn; }
            double age = (DateTime.Now - ripple).TotalMilliseconds;
            if (age < 450) {
                float t = (float)(age / 450.0);
                float rad = (8 + 26 * t) * s * 1.25f;
                int alpha = (int)(200 * (1 - t));
                using (var pen = new Pen(Color.FromArgb(alpha, 90, 170, 216), 3 * s * 1.25f))
                    g.DrawEllipse(pen, (rxp - rx) * s - rad, (ryp - ry) * s - rad, rad * 2, rad * 2);
                using (var brush = new SolidBrush(Color.FromArgb(alpha / 2, 90, 170, 216)))
                    g.FillEllipse(brush, (rxp - rx) * s - rad * 0.55f, (ryp - ry) * s - rad * 0.55f, rad * 1.1f, rad * 1.1f);
            }
            if (on && x >= 0) DrawPointer(g, (x - rx) * s, (y - ry) * s, Math.Max(1.0f, s * 1.35f));
        }
        return frame;
    }


    static void DrawWindow(Graphics g, Win w, float s)
    {
                using (Bitmap b = Print(w.Handle, w.Rect)) {
                    if (w.Layered) b.MakeTransparent(Color.Black);
                    var src = new Rectangle(w.Frame.Left - w.Rect.Left, w.Frame.Top - w.Rect.Top,
                                            w.Frame.Right - w.Frame.Left, w.Frame.Bottom - w.Frame.Top);
                    var dst = new RectangleF((w.Frame.Left - rx) * s, (w.Frame.Top - ry) * s,
                                             src.Width * s, src.Height * s);
                    g.DrawImage(b, dst, src, GraphicsUnit.Pixel);
                }
                }

    static void DrawPointer(Graphics g, float x, float y, float k)
    {
        PointF[] arrow = {
            new PointF(0, 0), new PointF(0, 17), new PointF(4.2f, 13), new PointF(7.2f, 19.6f),
            new PointF(10, 18.4f), new PointF(7.1f, 12.1f), new PointF(12.6f, 12.1f)
        };
        for (int i = 0; i < arrow.Length; i++) arrow[i] = new PointF(x + arrow[i].X * k, y + arrow[i].Y * k);
        using (var fill = new SolidBrush(Color.White)) g.FillPolygon(fill, arrow);
        using (var pen = new Pen(Color.FromArgb(28, 35, 43), 1.4f * k)) { pen.LineJoin = LineJoin.Round; g.DrawPolygon(pen, arrow); }
    }

    static void RecordLoop(object outPath)
    {
        var psi = new ProcessStartInfo(ffmpegPath,
            string.Format("-v error -y -f rawvideo -pix_fmt bgra -s {0}x{1} -framerate {2} -i - " +
                          "-c:v libx264 -preset veryfast -crf 16 -pix_fmt yuv420p \"{3}\"", ow, oh, fps, outPath));
        psi.UseShellExecute = false;
        psi.RedirectStandardInput = true;
        psi.CreateNoWindow = true;
        Process ff = Process.Start(psi);
        Stream stdin = ff.StandardInput.BaseStream;
        byte[] buffer = new byte[ow * oh * 4];
        var watch = Stopwatch.StartNew();
        long written = 0;
        while (recording) {
            using (Bitmap frame = Compose()) {
                BitmapData data = frame.LockBits(new Rectangle(0, 0, ow, oh), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                Marshal.Copy(data.Scan0, buffer, 0, buffer.Length);
                frame.UnlockBits(data);
            }
            // keep the video on the wall clock: a slow frame is repeated
            long due = (long)(watch.Elapsed.TotalSeconds * fps) + 1;
            do { stdin.Write(buffer, 0, buffer.Length); written++; } while (written < due);
            int sleep = (int)(written * 1000.0 / fps - watch.Elapsed.TotalMilliseconds);
            if (sleep > 0) Thread.Sleep(sleep);
        }
        stdin.Close();
        ff.WaitForExit();
        Log(string.Format("recorded {0} frames to {1}", written, outPath));
    }

    // ------------------------------------------------------------ input

    static IntPtr TargetAt(int x, int y, out Native.POINT client)
    {
        client = new Native.POINT();
        foreach (Win w in Windows(pid)) {
            if (x >= w.Frame.Left && x < w.Frame.Right && y >= w.Frame.Top && y < w.Frame.Bottom) {
                client.X = x; client.Y = y;
                Native.ScreenToClient(w.Handle, ref client);
                return w.Handle;
            }
        }
        return IntPtr.Zero;
    }

    static IntPtr Pack(int lo, int hi) { return new IntPtr((hi << 16) | (lo & 0xFFFF)); }

    static void MovePointer(float x, float y, int ms)
    {
        float sx, sy;
        lock (pointerLock) { sx = px; sy = py; }
        if (sx < 0 || ms <= 0) { lock (pointerLock) { px = x; py = y; } return; }
        int steps = Math.Max(1, ms / 15);
        for (int i = 1; i <= steps; i++) {
            float t = (float)i / steps;
            t = t * t * (3 - 2 * t);
            lock (pointerLock) { px = sx + (x - sx) * t; py = sy + (y - sy) * t; }
            Native.POINT c;
            IntPtr h = TargetAt((int)px, (int)py, out c);
            if (h != IntPtr.Zero) Native.PostMessage(h, 0x0200, IntPtr.Zero, Pack(c.X, c.Y));
            Thread.Sleep(15);
        }
    }

    static void Click(int x, int y, int count, bool right)
    {
        MovePointer(x, y, 450);
        Thread.Sleep(120);
        Native.POINT c;
        IntPtr h = TargetAt(x, y, out c);
        if (h == IntPtr.Zero) { Log("nothing under " + x + "," + y); return; }
        lastTarget = h;
        lock (pointerLock) { rippleAt = DateTime.Now; rippleX = x; rippleY = y; }
        uint down = right ? 0x0204u : 0x0201u, up = right ? 0x0205u : 0x0202u;
        IntPtr flag = new IntPtr(right ? 2 : 1);
        for (int i = 0; i < count; i++) {
            Native.PostMessage(h, 0x0200, IntPtr.Zero, Pack(c.X, c.Y));
            Native.PostMessage(h, i == 1 ? 0x0203u : down, flag, Pack(c.X, c.Y));
            Thread.Sleep(60);
            Native.PostMessage(h, up, IntPtr.Zero, Pack(c.X, c.Y));
            Thread.Sleep(80);
        }
    }

    // Half a click: a button with an instant popup opens its menu on the
    // press, and the release that follows at once would close it again.
    static void Half(int x, int y, bool down)
    {
        if (down) MovePointer(x, y, 450);
        Native.POINT c;
        IntPtr h = TargetAt(x, y, out c);
        if (h == IntPtr.Zero) { Log("nothing under " + x + "," + y); return; }
        if (down) {
            lastTarget = h;
            lock (pointerLock) { rippleAt = DateTime.Now; rippleX = x; rippleY = y; }
        }
        Native.PostMessage(h, 0x0200, IntPtr.Zero, Pack(c.X, c.Y));
        Native.PostMessage(h, down ? 0x0201u : 0x0202u, new IntPtr(down ? 1 : 0), Pack(c.X, c.Y));
    }

    static void Drag(int x1, int y1, int x2, int y2, int ms)
    {
        MovePointer(x1, y1, 400);
        Native.POINT c;
        IntPtr h = TargetAt(x1, y1, out c);
        if (h == IntPtr.Zero) return;
        Native.RECT r; Native.GetWindowRect(h, out r);
        Native.PostMessage(h, 0x0201, new IntPtr(1), Pack(c.X, c.Y));
        int steps = Math.Max(1, ms / 16);
        for (int i = 1; i <= steps; i++) {
            float t = (float)i / steps;
            float x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
            lock (pointerLock) { px = x; py = y; }
            Native.POINT p = new Native.POINT(); p.X = (int)x; p.Y = (int)y;
            Native.ScreenToClient(h, ref p);
            Native.PostMessage(h, 0x0200, new IntPtr(1), Pack(p.X, p.Y));
            Thread.Sleep(16);
        }
        Native.POINT e = new Native.POINT(); e.X = x2; e.Y = y2;
        Native.ScreenToClient(h, ref e);
        Native.PostMessage(h, 0x0202, IntPtr.Zero, Pack(e.X, e.Y));
    }

    static int VirtualKey(string name)
    {
        switch (name.ToUpperInvariant()) {
        case "ENTER": return 0x0D; case "ESC": return 0x1B; case "TAB": return 0x09;
        case "BACK": return 0x08; case "DOWN": return 0x28; case "UP": return 0x26;
        case "LEFT": return 0x25; case "RIGHT": return 0x27; case "HOME": return 0x24;
        case "END": return 0x23; case "DEL": return 0x2E; case "SPACE": return 0x20;
        }
        return Convert.ToInt32(name, 16);
    }

    static IntPtr KeyTarget()
    {
        // An open menu takes the keys: Qt hands them to the popup only when
        // they arrive at its own window.
        foreach (Win w in Windows(pid)) {
            var cls = new StringBuilder(256); Native.GetClassName(w.Handle, cls, 256);
            if (cls.ToString().Contains("Popup")) return w.Handle;
        }
        if (lastTarget != IntPtr.Zero && Native.IsWindowVisible(lastTarget)) return lastTarget;
        List<Win> wins = Windows(pid);
        return wins.Count > 0 ? wins[0].Handle : IntPtr.Zero;
    }

    static void Key(string name)
    {
        int vk = VirtualKey(name);
        uint scan = Native.MapVirtualKey((uint)vk, 0);
        IntPtr h = KeyTarget();
        Native.PostMessage(h, 0x0100, new IntPtr(vk), new IntPtr(1 | (int)(scan << 16)));
        if (vk == 0x0D || vk == 0x09 || vk == 0x1B || vk == 0x20 || vk == 0x08)
            Native.PostMessage(h, 0x0102, new IntPtr(vk), new IntPtr(1 | (int)(scan << 16)));
        Thread.Sleep(40);
        Native.PostMessage(h, 0x0101, new IntPtr(vk), new IntPtr(unchecked((int)(1 | (scan << 16) | 0xC0000000))));
        Thread.Sleep(60);
    }

    static void Type(string text)
    {
        IntPtr h = KeyTarget();
        foreach (char ch in text) {
            Native.PostMessage(h, 0x0102, new IntPtr(ch), new IntPtr(1));
            Thread.Sleep(55);
        }
    }

    static void Wheel(int x, int y, int delta)
    {
        MovePointer(x, y, 300);
        Native.POINT c;
        IntPtr h = TargetAt(x, y, out c);
        if (h == IntPtr.Zero) return;
        Native.PostMessage(h, 0x020A, new IntPtr(delta << 16), Pack(x, y));
    }

    // ------------------------------------------------------------ script

    static void Log(string text)
    {
        string line = string.Format("{0,8:F2} {1}", clock.Elapsed.TotalSeconds, text);
        Console.WriteLine(line);
        if (logFile != null) { logFile.WriteLine(line); logFile.Flush(); }
    }

    static int Run(string file)
    {
        clock.Start();
        logFile = new StreamWriter(file + ".log", false, new UTF8Encoding(false));
        foreach (string raw in File.ReadAllLines(file, Encoding.UTF8)) {
            string line = raw.Trim();
            if (line.Length == 0 || line.StartsWith("#")) continue;
            int space = line.IndexOf(' ');
            string cmd = space < 0 ? line : line.Substring(0, space);
            string rest = space < 0 ? "" : line.Substring(space + 1);
            string[] a = rest.Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries);
            Log(line);
            switch (cmd) {
            case "pid": pid = uint.Parse(a[0]); break;
            case "region": rx = int.Parse(a[0]); ry = int.Parse(a[1]); rw = int.Parse(a[2]); rh = int.Parse(a[3]); break;
            case "size": ow = int.Parse(a[0]); oh = int.Parse(a[1]); break;
            case "fps": fps = int.Parse(a[0]); break;
            case "bg": background = new Bitmap(rest); break;
            case "ffmpeg": ffmpegPath = rest; break;
            case "pointer": lock (pointerLock) pointerOn = a[0] == "on"; break;
            case "record":
                recording = true;
                recorder = new Thread(RecordLoop);
                recorder.Start(rest);
                break;
            case "stop":
                recording = false;
                if (recorder != null) recorder.Join();
                break;
            case "wait": Thread.Sleep(int.Parse(a[0])); break;
            case "pidtitle": {
                // the window with this text in its title gives the process
                pid = 0;
                for (int i = 0; i < 150 && pid == 0; i++) {
                    Native.EnumWindows(delegate (IntPtr h, IntPtr l) {
                        var title = new StringBuilder(256);
                        Native.GetWindowText(h, title, 256);
                        if (Native.IsWindowVisible(h) && title.ToString().Contains(rest)) { Native.GetWindowThreadProcessId(h, out pid); return false; }
                        return true;
                    }, IntPtr.Zero);
                    if (pid == 0) Thread.Sleep(100);
                }
                Log("pid " + pid);
                break;
            }
            case "consolefont": {
                // large letters for a small video; only this console, no settings are touched
                Native.FreeConsole();
                if (Native.AttachConsole(pid)) {
                    IntPtr output = Native.CreateFile("CONOUT$", 0xC0000000u, 3, IntPtr.Zero, 3, 0, IntPtr.Zero);
                    var font = new Native.CONSOLE_FONT_INFOEX();
                    font.cbSize = (uint)Marshal.SizeOf(font);
                    font.Y = short.Parse(a[0]);
                    font.FontFamily = 54;
                    font.FontWeight = 400;
                    font.FaceName = "Consolas";
                    Native.SetCurrentConsoleFontEx(output, false, ref font);
                    Native.FreeConsole();
                }
                break;
            }
            case "waitwin":
                for (int i = 0; i < 300 && Windows(pid).Count == 0; i++) Thread.Sleep(100);
                break;
            case "place": {
                // the biggest window of the process is its main one
                Win main = null;
                foreach (Win w in Windows(pid))
                    if (main == null || (w.Rect.Right - w.Rect.Left) > (main.Rect.Right - main.Rect.Left)) main = w;
                if (main != null) Native.MoveWindow(main.Handle, int.Parse(a[0]), int.Parse(a[1]), int.Parse(a[2]), int.Parse(a[3]), true);
                break;
            }
            case "stamp":
                File.WriteAllText(rest, ((long)(DateTime.UtcNow - new DateTime(1970, 1, 1)).TotalMilliseconds).ToString());
                break;
            case "waitclosed": {
                // until the process has no windows left, or the limit in ms
                var clockClosed = Stopwatch.StartNew();
                while (clockClosed.ElapsedMilliseconds < int.Parse(a[0]) && Windows(pid).Count > 0) Thread.Sleep(200);
                break;
            }
            case "waitshown": {
                int shownWidth = int.Parse(a[0]), shownLimit = int.Parse(a[1]);
                var clockShown = Stopwatch.StartNew();
                while (clockShown.ElapsedMilliseconds < shownLimit) {
                    bool there = false;
                    foreach (Win w in Windows(pid)) if (w.Frame.Right - w.Frame.Left == shownWidth) there = true;
                    if (there) break;
                    Thread.Sleep(100);
                }
                break;
            }
            case "waitgone": {
                // until the process has no window with this much width, or the limit in ms
                int width = int.Parse(a[0]), limit = int.Parse(a[1]);
                var clockWait = Stopwatch.StartNew();
                while (clockWait.ElapsedMilliseconds < limit) {
                    bool there = false;
                    foreach (Win w in Windows(pid)) if (w.Frame.Right - w.Frame.Left == width) there = true;
                    if (!there) break;
                    Thread.Sleep(200);
                }
                break;
            }
            case "point": MovePointer(float.Parse(a[0]), float.Parse(a[1]), a.Length > 2 ? int.Parse(a[2]) : 450); break;
            case "click": Click(int.Parse(a[0]), int.Parse(a[1]), 1, false); break;
            case "dclick": Click(int.Parse(a[0]), int.Parse(a[1]), 2, false); break;
            case "rclick": Click(int.Parse(a[0]), int.Parse(a[1]), 1, true); break;
            case "down": Half(int.Parse(a[0]), int.Parse(a[1]), true); break;
            case "up": Half(int.Parse(a[0]), int.Parse(a[1]), false); break;
            case "drag": Drag(int.Parse(a[0]), int.Parse(a[1]), int.Parse(a[2]), int.Parse(a[3]), int.Parse(a[4])); break;
            case "type": Type(rest); break;
            case "key": Key(a[0]); break;
            case "wheel": Wheel(int.Parse(a[0]), int.Parse(a[1]), int.Parse(a[2])); break;
            case "shot": using (Bitmap b = Compose()) b.Save(rest, ImageFormat.Png); break;
            case "log": break;
            default: Log("unknown command " + cmd); break;
            }
        }
        if (recording) { recording = false; recorder.Join(); }
        logFile.Close();
        return 0;
    }
}
