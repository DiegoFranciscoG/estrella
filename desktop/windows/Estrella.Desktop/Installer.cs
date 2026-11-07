using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace Estrella.Desktop;

/// <summary>
/// Installs, updates and uninstalls for the current user: files in %LOCALAPPDATA%\Programs, a Start
/// menu shortcut and an entry in Settings &gt; Apps (HKCU). Never needs administrator rights and never
/// touches the student's data folder, except when uninstalling with "delete my data".
/// </summary>
internal static class Installer
{
    /// <summary>Held by the running app, so setup can tell the student to close it first.</summary>
    public const string RunningMutexName = @"Local\ESTRELLA.Desktop";

    public static bool AppIsRunning()
    {
        if (!Mutex.TryOpenExisting(RunningMutexName, out var mutex)) return false;
        mutex.Dispose();
        return true;
    }

    public static string? InstalledVersion()
    {
        using var key = Registry.CurrentUser.OpenSubKey(InstallLayout.UninstallKey);
        return key?.GetValue("DisplayVersion") as string;
    }

    /// <summary>Copies this .exe into place (replacing an older one) and registers it.</summary>
    public static void Install(InstallLayout layout, string sourceExe)
    {
        Directory.CreateDirectory(layout.InstallDir);
        if (!layout.IsInstalledCopy(sourceExe))
        {
            var temp = layout.ExePath + ".new";
            File.Copy(sourceExe, temp, overwrite: true);
            if (File.Exists(layout.ExePath)) File.Delete(layout.ExePath);
            File.Move(temp, layout.ExePath);
        }
        var notices = EmbeddedAssemblies.Resource("notices/WebView2-LICENSE.txt");
        File.WriteAllText(layout.NoticesPath, Notices(notices is null ? "" : Encoding.UTF8.GetString(notices)), new UTF8Encoding(false));
        CreateShortcut(layout);
        using (var key = Registry.CurrentUser.CreateSubKey(InstallLayout.UninstallKey))
        {
            foreach (var pair in layout.UninstallValues(AppInfo.DisplayVersion, new FileInfo(layout.ExePath).Length))
            {
                key.SetValue(pair.Key, pair.Value, pair.Value is int ? RegistryValueKind.DWord : RegistryValueKind.String);
            }
        }
        // Loaders of older versions are no longer used by anyone.
        if (Directory.Exists(layout.LoaderRoot))
        {
            foreach (var dir in Directory.GetDirectories(layout.LoaderRoot))
            {
                if (!string.Equals(Path.GetFileName(dir), AppInfo.DisplayVersion, StringComparison.Ordinal)) TryDelete(dir);
            }
        }
    }

    /// <summary>
    /// Removes the shortcut, the Settings entry and the program. The running .exe cannot delete its own
    /// folder, so a hidden command does it two seconds after this process ends.
    /// </summary>
    public static void Uninstall(InstallLayout layout, bool deleteData)
    {
        if (File.Exists(layout.ShortcutPath)) File.Delete(layout.ShortcutPath);
        Registry.CurrentUser.DeleteSubKeyTree(InstallLayout.UninstallKey, throwOnMissingSubKey: false);
        TryDelete(layout.LoaderRoot);
        var command = new StringBuilder("/d /c ping 127.0.0.1 -n 3 > nul");
        if (Directory.Exists(layout.InstallDir)) command.Append($" & rmdir /s /q \"{layout.InstallDir}\"");
        if (deleteData && Directory.Exists(layout.DataDir)) command.Append($" & rmdir /s /q \"{layout.DataDir}\"");
        Process.Start(new ProcessStartInfo("cmd.exe", command.ToString())
        {
            CreateNoWindow = true,
            UseShellExecute = false,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = Path.GetTempPath(),
        })?.Dispose();
    }

    private static void CreateShortcut(InstallLayout layout)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(layout.ShortcutPath)!);
        var shellType = Type.GetTypeFromProgID("WScript.Shell") ?? throw new InvalidOperationException("Windows Script Host no está disponible.");
        dynamic shell = Activator.CreateInstance(shellType)!;
        try
        {
            dynamic link = shell.CreateShortcut(layout.ShortcutPath);
            link.TargetPath = layout.ExePath;
            link.WorkingDirectory = layout.InstallDir;
            link.Description = "Programas libres de diseño, CAD y edición para estudiantes";
            link.IconLocation = layout.ExePath + ",0";
            link.Save();
        }
        finally
        {
            System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
        }
    }

    private static string Notices(string webView2License) =>
        "ESTRELLA para Windows " + AppInfo.DisplayVersion + "\r\n"
        + "Copyright (c) 2026 Diego Francisco Granda Zhingre. Licencia MIT. Código: " + AppInfo.RepositoryUrl + "\r\n\r\n"
        + "Este programa incluye el SDK de Microsoft Edge WebView2 (Microsoft.Web.WebView2), con esta licencia:\r\n\r\n"
        + webView2License.Replace("\r\n", "\n").Replace("\n", "\r\n");

    private static void TryDelete(string dir)
    {
        try
        {
            if (Directory.Exists(dir)) Directory.Delete(dir, recursive: true);
        }
        catch (IOException)
        {
            // In use right now: harmless leftovers, removed on the next install or uninstall.
        }
        catch (UnauthorizedAccessException)
        {
            // Same as above.
        }
    }
}
