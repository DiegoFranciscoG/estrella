using System.Text.RegularExpressions;

namespace Estrella.Desktop;

/// <summary>
/// The only conversation between ESTRELLA's page and the app: "install this program from the guide".
/// One specific message instead of a generic bridge (WebView2 security guidance).
/// </summary>
internal static class BridgeMessages
{
    private static readonly Regex Install = new("^estrella:desktop:install:([a-z]{2,20})$", RegexOptions.CultureInvariant);

    /// <summary>The guide key of the program to install, or null for anything else.</summary>
    public static string? ToolToInstall(string? message)
    {
        if (message is null) return null;
        var match = Install.Match(message);
        return match.Success ? match.Groups[1].Value : null;
    }

    /// <summary>Outcomes: started, cancelled, unavailable (no winget) or rejected (not in the list).</summary>
    public static string Reply(string outcome, string tool) => $"estrella:desktop:{outcome}:{tool}";
}
