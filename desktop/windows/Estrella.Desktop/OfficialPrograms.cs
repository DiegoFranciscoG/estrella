using System;
using System.Collections.Generic;

namespace Estrella.Desktop;

internal sealed class OfficialProgram
{
    public OfficialProgram(string name, string wingetId, string site)
    {
        Name = name;
        WingetId = wingetId;
        Site = site;
    }

    public string Name { get; }

    public string WingetId { get; }

    public string Site { get; }
}

/// <summary>
/// The free desktop programs the guide recommends, with their winget packages. The page only says
/// which one (by its guide key); the command is built here from this closed list, so nothing the
/// page sends ever reaches the command line. winget checks each installer's hash.
/// </summary>
internal static class OfficialPrograms
{
    public static IReadOnlyDictionary<string, OfficialProgram> All { get; } = new Dictionary<string, OfficialProgram>(StringComparer.Ordinal)
    {
        ["librecad"] = new("LibreCAD", "LibreCAD.LibreCAD", "https://librecad.org/"),
        ["freecad"] = new("FreeCAD", "FreeCAD.FreeCAD", "https://www.freecad.org/"),
        ["blender"] = new("Blender", "BlenderFoundation.Blender", "https://www.blender.org/"),
        ["gimp"] = new("GIMP", "GIMP.GIMP.3", "https://www.gimp.org/"),
        ["inkscape"] = new("Inkscape", "Inkscape.Inkscape", "https://inkscape.org/"),
        ["scribus"] = new("Scribus", "Scribus.Scribus", "https://www.scribus.net/"),
        ["darktable"] = new("darktable", "darktable.darktable", "https://www.darktable.org/"),
        ["digikam"] = new("digiKam", "KDE.digiKam", "https://www.digikam.org/"),
        ["kdenlive"] = new("Kdenlive", "KDE.Kdenlive", "https://kdenlive.org/"),
    };

    public static OfficialProgram? Find(string tool) => All.TryGetValue(tool, out var program) ? program : null;

    /// <summary>Exact package id from the community source; the student sees winget's own prompts.</summary>
    public static string WingetArguments(OfficialProgram program) =>
        $"install --id {program.WingetId} --exact --source winget";
}
