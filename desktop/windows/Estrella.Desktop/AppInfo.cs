using System;
using System.Linq;
using System.Reflection;

namespace Estrella.Desktop;

/// <summary>What this build is and which ESTRELLA it opens, fixed when it was built.</summary>
internal static class AppInfo
{
    public const string Name = "ESTRELLA";
    public const string Publisher = "Diego Francisco Granda Zhingre";
    public const string RepositoryUrl = "https://github.com/DiegoFranciscoG/estrella";

    public static string DisplayVersion { get; } = FormatVersion(typeof(AppInfo).Assembly.GetName().Version);

    /// <summary>The ESTRELLA web app, from <c>-p:EstrellaUrl</c> at build time.</summary>
    public static Uri AppUrl { get; } = ParseAppUrl(typeof(AppInfo).Assembly
        .GetCustomAttributes<AssemblyMetadataAttribute>()
        .FirstOrDefault(a => a.Key == "EstrellaUrl")?.Value);

    internal static string FormatVersion(Version? version) =>
        version is null ? "0.0.0" : $"{version.Major}.{version.Minor}.{Math.Max(0, version.Build)}";

    /// <summary>
    /// Only HTTPS, or plain HTTP on this computer for development: the app must never show ESTRELLA
    /// from a connection anyone on the network could alter.
    /// </summary>
    internal static Uri ParseAppUrl(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw) || !Uri.TryCreate(raw, UriKind.Absolute, out var url))
        {
            throw new InvalidOperationException("Esta copia de ESTRELLA no sabe qué dirección abrir.");
        }
        var secure = url.Scheme == Uri.UriSchemeHttps || (url.Scheme == Uri.UriSchemeHttp && url.IsLoopback);
        if (!secure || !string.IsNullOrEmpty(url.UserInfo))
        {
            throw new InvalidOperationException("La dirección de ESTRELLA debe usar HTTPS.");
        }
        return new Uri(url.GetLeftPart(UriPartial.Authority) + "/");
    }
}
