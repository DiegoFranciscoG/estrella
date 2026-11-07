using System;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using Xunit;

namespace Estrella.Desktop.Tests;

public class NavigationPolicyTests
{
    private readonly NavigationPolicy policy = new(new Uri("https://estrella.example/"));

    private static NavigationDecision Decision(string name) => (NavigationDecision)Enum.Parse(typeof(NavigationDecision), name);

    [Theory]
    [InlineData("https://estrella.example/#/p/1", "Allow")]
    [InlineData("https://openrouter.ai/auth?code_challenge=x", "Allow")]
    [InlineData("http://localhost:8088/", "Allow")]
    [InlineData("http://127.0.0.1:8091/auth", "Allow")]
    [InlineData("about:blank", "Allow")]
    [InlineData("http://example.com/", "OpenInBrowser")]
    [InlineData("mailto:alguien@example.com", "OpenInBrowser")]
    [InlineData("file:///C:/Windows/System32/calc.exe", "Block")]
    [InlineData("javascript:alert(1)", "Block")]
    [InlineData("ms-settings:privacy", "Block")]
    [InlineData("data:text/html,<script>alert(1)</script>", "Block")]
    [InlineData("no es una dirección", "Block")]
    [InlineData(null, "Block")]
    public void TheWindowStaysOnTheSecureWeb(string? url, string expected)
    {
        Assert.Equal(Decision(expected), policy.TopLevel(url));
    }

    [Theory]
    [InlineData("https://apps.estrella.example/apps/plano/index.html", "Allow")]
    [InlineData("blob:https://apps.estrella.example/1234", "Allow")]
    [InlineData("about:srcdoc", "Allow")]
    [InlineData("file:///C:/secreto.txt", "Block")]
    [InlineData("javascript:alert(1)", "Block")]
    public void FramesMayOnlyShowWebPages(string url, string expected)
    {
        Assert.Equal(Decision(expected), policy.Frame(url));
    }

    [Theory]
    [InlineData("https://wiki.freecad.org/", "OpenInBrowser")]
    [InlineData("mailto:alguien@example.com", "OpenInBrowser")]
    [InlineData("file:///C:/Windows/notepad.exe", "Block")]
    [InlineData("ms-settings:", "Block")]
    public void NewWindowsGoToTheBrowser(string url, string expected)
    {
        Assert.Equal(Decision(expected), policy.NewWindow(url));
    }

    [Theory]
    [InlineData("https://estrella.example/#/guia", true)]
    [InlineData("https://ESTRELLA.example/", true)]
    [InlineData("https://estrella.example.evil.com/", false)]
    [InlineData("http://estrella.example/", false)]
    [InlineData("https://estrella.example:8443/", false)]
    [InlineData("https://openrouter.ai/", false)]
    [InlineData("", false)]
    public void OnlyEstrellaItselfMayTalkToTheApp(string source, bool accepted)
    {
        Assert.Equal(accepted, policy.AcceptsMessagesFrom(source));
    }
}

public class AppInfoTests
{
    [Theory]
    [InlineData("https://estrella.example", "https://estrella.example/")]
    [InlineData("https://estrella.example/some/path?x=1", "https://estrella.example/")]
    [InlineData("http://localhost:8088", "http://localhost:8088/")]
    [InlineData("http://127.0.0.1:8088/", "http://127.0.0.1:8088/")]
    public void AcceptsHttpsOrThisComputer(string raw, string expected)
    {
        Assert.Equal(expected, AppInfo.ParseAppUrl(raw).ToString());
    }

    [Theory]
    [InlineData("http://estrella.example")]
    [InlineData("https://usuario:clave@estrella.example")]
    [InlineData("file:///C:/estrella/index.html")]
    [InlineData("")]
    [InlineData(null)]
    public void RefusesAnyOtherAddress(string? raw)
    {
        Assert.Throws<InvalidOperationException>(() => AppInfo.ParseAppUrl(raw));
    }

    [Fact]
    public void ShowsThreePartVersions()
    {
        Assert.Equal("0.8.0", AppInfo.FormatVersion(new Version(0, 8, 0, 0)));
        Assert.Equal("1.2.0", AppInfo.FormatVersion(new Version(1, 2)));
        Assert.Equal("0.0.0", AppInfo.FormatVersion(null));
    }
}

public class BridgeMessagesTests
{
    [Theory]
    [InlineData("estrella:desktop:install:freecad", "freecad")]
    [InlineData("estrella:desktop:install:gimp", "gimp")]
    [InlineData("estrella:desktop:install:FreeCAD", null)]
    [InlineData("estrella:desktop:install:freecad & calc", null)]
    [InlineData("estrella:desktop:install:", null)]
    [InlineData("estrella:desktop:run:cmd", null)]
    [InlineData("{\"type\":\"install\"}", null)]
    [InlineData(null, null)]
    public void UnderstandsOnlyTheInstallRequest(string? message, string? tool)
    {
        Assert.Equal(tool, BridgeMessages.ToolToInstall(message));
    }

    [Fact]
    public void RepliesNameTheProgram()
    {
        Assert.Equal("estrella:desktop:started:freecad", BridgeMessages.Reply("started", "freecad"));
    }
}

public class OfficialProgramsTests
{
    [Fact]
    public void BuildsTheCommandFromTheClosedListOnly()
    {
        var freecad = OfficialPrograms.Find("freecad")!;
        Assert.Equal("install --id FreeCAD.FreeCAD --exact --source winget", OfficialPrograms.WingetArguments(freecad));
        Assert.Null(OfficialPrograms.Find("calc"));
        Assert.Null(OfficialPrograms.Find("FreeCAD"));
        Assert.All(OfficialPrograms.All.Values, p =>
        {
            Assert.Matches("^[A-Za-z0-9]+(\\.[A-Za-z0-9]+)+$", p.WingetId);
            Assert.StartsWith("https://", p.Site);
        });
    }

    /// <summary>Every desktop program the guide recommends can be installed, with the same official site.</summary>
    [Fact]
    public void MatchesTheGuide()
    {
        var guide = File.ReadAllText(FindUp(Path.Combine("frontend", "src", "data", "guia.json")));
        var tools = Regex.Matches(guide, "\"(?<key>[a-z]+)\"\\s*:\\s*\\{\\s*\"name\"\\s*:\\s*\"(?<name>[^\"]+)\"\\s*,\\s*\"where\"\\s*:\\s*\"escritorio\"\\s*,\\s*\"site\"\\s*:\\s*\"(?<site>[^\"]+)\"")
            .Cast<Match>()
            .ToDictionary(m => m.Groups["key"].Value, m => (Name: m.Groups["name"].Value, Site: m.Groups["site"].Value));
        Assert.NotEmpty(tools);
        Assert.Equal(tools.Keys.OrderBy(k => k), OfficialPrograms.All.Keys.OrderBy(k => k));
        foreach (var pair in tools)
        {
            Assert.Equal(pair.Value.Name, OfficialPrograms.All[pair.Key].Name);
            Assert.Equal(pair.Value.Site, OfficialPrograms.All[pair.Key].Site);
        }
    }

    /// <summary>From the test binaries or, when they were built outside the repository, from ESTRELLA_REPO.</summary>
    private static string FindUp(string relative)
    {
        foreach (var start in new[] { AppContext.BaseDirectory, Environment.GetEnvironmentVariable("ESTRELLA_REPO") ?? Environment.CurrentDirectory })
        {
            for (var dir = new DirectoryInfo(start); dir is not null; dir = dir.Parent)
            {
                var candidate = Path.Combine(dir.FullName, relative);
                if (File.Exists(candidate)) return candidate;
            }
        }
        throw new FileNotFoundException(relative);
    }
}

public class InstallLayoutTests
{
    private readonly InstallLayout layout = new(@"C:\Users\ana\AppData\Local", @"C:\Users\ana\AppData\Roaming\Microsoft\Windows\Start Menu\Programs");

    [Fact]
    public void KeepsTheProgramAndTheDataApart()
    {
        Assert.Equal(@"C:\Users\ana\AppData\Local\Programs\ESTRELLA\ESTRELLA.exe", layout.ExePath);
        Assert.Equal(@"C:\Users\ana\AppData\Local\ESTRELLA\WebView2", layout.WebViewDataDir);
        Assert.False(layout.WebViewDataDir.StartsWith(layout.InstallDir, StringComparison.OrdinalIgnoreCase));
        Assert.StartsWith(layout.DataDir, layout.LoaderDir("win-x64"));
        Assert.Equal(@"C:\Users\ana\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\ESTRELLA.lnk", layout.ShortcutPath);
        Assert.True(layout.IsInstalledCopy(@"c:\users\ANA\appdata\local\programs\estrella\estrella.exe"));
        Assert.False(layout.IsInstalledCopy(@"C:\Users\ana\Downloads\ESTRELLA.exe"));
    }

    [Fact]
    public void RegistersWhatSettingsAppsShows()
    {
        var values = layout.UninstallValues("0.8.0", 1_320_960);
        Assert.Equal("ESTRELLA", values["DisplayName"]);
        Assert.Equal("0.8.0", values["DisplayVersion"]);
        Assert.Equal("Diego Francisco Granda Zhingre", values["Publisher"]);
        Assert.Equal("\"C:\\Users\\ana\\AppData\\Local\\Programs\\ESTRELLA\\ESTRELLA.exe\" --uninstall", values["UninstallString"]);
        Assert.EndsWith("--uninstall --silent", (string)values["QuietUninstallString"]);
        Assert.Equal(1290, values["EstimatedSize"]);
        Assert.Equal(1, values["NoModify"]);
        Assert.Equal(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\ESTRELLA", InstallLayout.UninstallKey);
    }

    [Theory]
    [InlineData("0.8.1", "0.8.0", true)]
    [InlineData("0.9.0", null, true)]
    [InlineData("0.8.0", "0.8.0", false)]
    [InlineData("0.8.0", "0.10.0", false)]
    [InlineData("no", "0.8.0", false)]
    public void UpdatesOnlyToNewerVersions(string candidate, string? installed, bool newer)
    {
        Assert.Equal(newer, InstallLayout.IsNewer(candidate, installed));
    }
}

public class SingleFileTests
{
    /// <summary>The .exe carries WebView2 for every Windows architecture and its licence, so it ships alone.</summary>
    [Fact]
    public void CarriesWebView2Inside()
    {
        var names = typeof(AppInfo).Assembly.GetManifestResourceNames();
        Assert.Contains("lib/Microsoft.Web.WebView2.Core.dll", names);
        Assert.Contains("lib/Microsoft.Web.WebView2.WinForms.dll", names);
        foreach (var arch in new[] { "win-x64", "win-arm64", "win-x86" }) Assert.Contains($"native/{arch}/WebView2Loader.dll", names);
        Assert.Contains("notices/WebView2-LICENSE.txt", names);
        Assert.Contains("Redistribution", System.Text.Encoding.UTF8.GetString(EmbeddedAssemblies.Resource("notices/WebView2-LICENSE.txt")!));
    }
}
