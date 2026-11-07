using System;
using System.Collections.Generic;
using System.IO;

namespace Estrella.Desktop;

/// <summary>
/// Where ESTRELLA for Windows lives, per user and without administrator rights. The program and
/// the student's data are in different folders on purpose: installing and updating replace only the
/// program, and uninstalling keeps the data unless the student asks otherwise.
/// </summary>
internal sealed class InstallLayout
{
    public const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\ESTRELLA";
    public const string ExeName = "ESTRELLA.exe";

    private readonly string localAppData;
    private readonly string startMenuPrograms;

    public InstallLayout(string localAppData, string startMenuPrograms)
    {
        this.localAppData = localAppData;
        this.startMenuPrograms = startMenuPrograms;
    }

    public static InstallLayout ForCurrentUser() => new(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        Environment.GetFolderPath(Environment.SpecialFolder.Programs));

    /// <summary>Same place per-user installers use (for example %LOCALAPPDATA%\Programs\Microsoft VS Code).</summary>
    public string InstallDir => Path.Combine(localAppData, "Programs", AppInfo.Name);

    public string ExePath => Path.Combine(InstallDir, ExeName);

    public string NoticesPath => Path.Combine(InstallDir, "AVISOS-DE-TERCEROS.txt");

    /// <summary>The student's data: WebView2's profile, with the projects saved on this computer.</summary>
    public string DataDir => Path.Combine(localAppData, AppInfo.Name);

    public string WebViewDataDir => Path.Combine(DataDir, "WebView2");

    /// <summary>WebView2's native loader, written from inside the .exe; not the student's data.</summary>
    public string LoaderRoot => Path.Combine(DataDir, "loader");

    public string LoaderDir(string architecture) => Path.Combine(LoaderRoot, AppInfo.DisplayVersion, architecture);

    public string ShortcutPath => Path.Combine(startMenuPrograms, AppInfo.Name + ".lnk");

    public bool IsInstalledCopy(string runningExe) =>
        string.Equals(Path.GetFullPath(runningExe), Path.GetFullPath(ExePath), StringComparison.OrdinalIgnoreCase);

    /// <summary>What Windows shows in Settings &gt; Apps (registry values under HKCU, so no administrator rights).</summary>
    public IReadOnlyDictionary<string, object> UninstallValues(string version, long sizeBytes) => new Dictionary<string, object>
    {
        ["DisplayName"] = AppInfo.Name,
        ["DisplayVersion"] = version,
        ["Publisher"] = AppInfo.Publisher,
        ["DisplayIcon"] = $"\"{ExePath}\",0",
        ["InstallLocation"] = InstallDir,
        ["UninstallString"] = $"\"{ExePath}\" --uninstall",
        ["QuietUninstallString"] = $"\"{ExePath}\" --uninstall --silent",
        ["URLInfoAbout"] = AppInfo.RepositoryUrl,
        ["NoModify"] = 1,
        ["NoRepair"] = 1,
        ["EstimatedSize"] = (int)Math.Max(1, (sizeBytes + 1023) / 1024),
    };

    /// <summary>Whether <paramref name="candidate"/> is newer than what is installed (missing counts as older).</summary>
    public static bool IsNewer(string candidate, string? installed)
    {
        if (!Version.TryParse(candidate, out var next)) return false;
        return !Version.TryParse(installed, out var current) || next > current;
    }
}
