using System;

namespace Estrella.Desktop;

internal enum NavigationDecision
{
    Allow,
    OpenInBrowser,
    Block,
}

/// <summary>
/// Where the app window may go (WebView2 security guidance: filter every navigation). ESTRELLA and
/// secure sign-in pages (the assistant connects through OpenRouter's) stay in the window; links
/// that open a new window go to the student's browser; anything that is not the web is blocked.
/// </summary>
internal sealed class NavigationPolicy
{
    private readonly string appOrigin;

    public NavigationPolicy(Uri appUrl)
    {
        appOrigin = Origin(appUrl);
    }

    public bool IsApp(Uri url) => Origin(url) == appOrigin;

    public NavigationDecision TopLevel(string? raw)
    {
        if (raw == "about:blank") return NavigationDecision.Allow;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var url)) return NavigationDecision.Block;
        if (url.Scheme == Uri.UriSchemeHttps) return NavigationDecision.Allow;
        if (url.Scheme == Uri.UriSchemeHttp) return url.IsLoopback ? NavigationDecision.Allow : NavigationDecision.OpenInBrowser;
        if (url.Scheme == Uri.UriSchemeMailto) return NavigationDecision.OpenInBrowser;
        // file:, data:, javascript:, ms-settings: and any other protocol handler on this computer.
        return NavigationDecision.Block;
    }

    /// <summary>Frames: the panel's own policy (CSP) already limits them to the programs site.</summary>
    public NavigationDecision Frame(string? raw)
    {
        if (raw is "about:blank" or "about:srcdoc") return NavigationDecision.Allow;
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var url)) return NavigationDecision.Block;
        return url.Scheme is "https" or "http" or "blob" ? NavigationDecision.Allow : NavigationDecision.Block;
    }

    /// <summary>A link that asks for a new window opens in the student's browser, never in a second app window.</summary>
    public NavigationDecision NewWindow(string? raw)
    {
        if (!Uri.TryCreate(raw, UriKind.Absolute, out var url)) return NavigationDecision.Block;
        return url.Scheme is "https" or "http" or "mailto" ? NavigationDecision.OpenInBrowser : NavigationDecision.Block;
    }

    /// <summary>Only ESTRELLA itself may send messages to the app; never a page it navigated to.</summary>
    public bool AcceptsMessagesFrom(string? source) =>
        Uri.TryCreate(source, UriKind.Absolute, out var url) && IsApp(url);

    private static string Origin(Uri url) => url.GetLeftPart(UriPartial.Authority).ToLowerInvariant();
}
