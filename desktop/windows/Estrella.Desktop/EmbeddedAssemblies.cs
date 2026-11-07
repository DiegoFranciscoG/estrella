using System;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace Estrella.Desktop;

/// <summary>
/// The app is a single .exe: WebView2's assemblies travel inside it as resources (see the .csproj).
/// Managed ones load from memory; the native loader must be a file, so it is written once per
/// version and architecture to the app's own folder.
/// </summary>
internal static class EmbeddedAssemblies
{
    /// <summary>Call first thing in Main, before any type that uses WebView2 is loaded.</summary>
    public static void Register()
    {
        AppDomain.CurrentDomain.AssemblyResolve += (_, args) =>
        {
            var name = new AssemblyName(args.Name).Name;
            var bytes = Resource($"lib/{name}.dll");
            return bytes is null ? null : Assembly.Load(bytes);
        };
    }

    public static byte[]? Resource(string logicalName)
    {
        using var stream = typeof(EmbeddedAssemblies).Assembly.GetManifestResourceStream(logicalName);
        if (stream is null) return null;
        using var copy = new MemoryStream();
        stream.CopyTo(copy);
        return copy.ToArray();
    }

    public static string Architecture() => RuntimeInformation.ProcessArchitecture switch
    {
        System.Runtime.InteropServices.Architecture.X64 => "win-x64",
        System.Runtime.InteropServices.Architecture.Arm64 => "win-arm64",
        System.Runtime.InteropServices.Architecture.X86 => "win-x86",
        var other => throw new PlatformNotSupportedException($"Arquitectura no soportada: {other}"),
    };

    /// <summary>Writes WebView2Loader.dll for this process if missing and returns its folder.</summary>
    public static string ExtractLoader(InstallLayout layout)
    {
        var architecture = Architecture();
        var dir = layout.LoaderDir(architecture);
        var path = Path.Combine(dir, "WebView2Loader.dll");
        if (File.Exists(path)) return dir;
        var bytes = Resource($"native/{architecture}/WebView2Loader.dll")
            ?? throw new InvalidOperationException("Falta un componente de WebView2 dentro de ESTRELLA.exe.");
        Directory.CreateDirectory(dir);
        var temp = path + ".tmp";
        File.WriteAllBytes(temp, bytes);
        File.Move(temp, path);
        return dir;
    }
}
