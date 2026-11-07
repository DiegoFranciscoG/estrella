using System;
using System.Linq;
using System.Runtime.CompilerServices;
using System.Threading;
using System.Windows.Forms;

namespace Estrella.Desktop;

/// <summary>
/// One .exe, three jobs. Downloaded and opened, it installs itself (or updates the installed copy).
/// Opened from where it is installed, it is the app. With --uninstall, it removes itself.
/// Options: --install, --uninstall, --silent, --delete-data, --run (open without installing).
/// </summary>
internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        EmbeddedAssemblies.Register();
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        var silent = args.Contains("--silent");
        try
        {
            var layout = InstallLayout.ForCurrentUser();
            var exe = Application.ExecutablePath;
            if (args.Contains("--uninstall")) return Setup.Uninstall(layout, silent, args.Contains("--delete-data"));
            if (args.Contains("--install") || (!args.Contains("--run") && !layout.IsInstalledCopy(exe))) return Setup.Install(layout, exe, silent);
            return RunApp(layout);
        }
        catch (Exception e) when (!silent)
        {
            MessageBox.Show($"ESTRELLA no pudo continuar: {e.Message}", AppInfo.Name, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }

    /// <summary>Kept apart so WebView2's types load only after the embedded assemblies are registered.</summary>
    [MethodImpl(MethodImplOptions.NoInlining)]
    private static int RunApp(InstallLayout layout)
    {
        using var running = new Mutex(false, Installer.RunningMutexName);
        Application.Run(new MainForm(layout));
        return 0;
    }
}
