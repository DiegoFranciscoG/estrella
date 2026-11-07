using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Estrella.Desktop;

/// <summary>
/// The app window: ESTRELLA in WebView2 with the hardening Microsoft recommends (no host objects, one
/// specific message, every navigation checked, no camera or microphone) and a bar that says so
/// whenever the window shows a page outside ESTRELLA.
/// </summary>
internal sealed class MainForm : Form
{
    private static readonly CoreWebView2PermissionKind[] Denied =
    {
        CoreWebView2PermissionKind.Microphone, CoreWebView2PermissionKind.Camera, CoreWebView2PermissionKind.Geolocation,
        CoreWebView2PermissionKind.Notifications, CoreWebView2PermissionKind.OtherSensors,
        CoreWebView2PermissionKind.MidiSystemExclusiveMessages, CoreWebView2PermissionKind.WindowManagement,
    };

    private readonly InstallLayout layout;
    private readonly NavigationPolicy policy = new(AppInfo.AppUrl);
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private readonly Panel awayBar = new() { Dock = DockStyle.Top, Height = 40, Visible = false, Padding = new Padding(12, 6, 12, 6) };
    private readonly Label awayLabel = new() { AutoSize = true, Dock = DockStyle.Left, TextAlign = ContentAlignment.MiddleLeft };

    public MainForm(InstallLayout layout)
    {
        this.layout = layout;
        Text = AppInfo.Name;
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        MinimumSize = new Size(640, 480);
        var area = Screen.PrimaryScreen?.WorkingArea ?? new Rectangle(0, 0, 1366, 768);
        Size = new Size(Math.Min(1440, area.Width * 9 / 10), Math.Min(960, area.Height * 9 / 10));
        StartPosition = FormStartPosition.CenterScreen;

        var back = new Button { Text = "Volver a ESTRELLA", AutoSize = true, Dock = DockStyle.Right };
        back.Click += (_, _) => view.CoreWebView2?.Navigate(AppInfo.AppUrl.ToString());
        awayBar.Controls.Add(awayLabel);
        awayBar.Controls.Add(back);
        Controls.Add(view);
        Controls.Add(awayBar);
        Load += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        try
        {
            CoreWebView2Environment.SetLoaderDllFolderPath(EmbeddedAssemblies.ExtractLoader(layout));
            var environment = await CoreWebView2Environment.CreateAsync(null, layout.WebViewDataDir, new CoreWebView2EnvironmentOptions { Language = "es" });
            await view.EnsureCoreWebView2Async(environment);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            var answer = MessageBox.Show(this,
                "Falta el componente WebView2 de Microsoft, que ESTRELLA usa para mostrarse. Windows 11 lo trae; en algunos Windows 10 hay que instalarlo.\n\n¿Abrir la página oficial de descarga?",
                AppInfo.Name, MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer == DialogResult.Yes) OpenInBrowser("https://developer.microsoft.com/microsoft-edge/webview2/consumer/");
            Close();
            return;
        }
        Configure(view.CoreWebView2);
        view.CoreWebView2.Navigate(AppInfo.AppUrl.ToString());
    }

    private void Configure(CoreWebView2 core)
    {
        var settings = core.Settings;
        settings.AreHostObjectsAllowed = false;
        settings.IsWebMessageEnabled = true;
        settings.IsStatusBarEnabled = false;
        settings.IsPasswordAutosaveEnabled = false;
        settings.IsGeneralAutofillEnabled = false;
#if !DEBUG
        settings.AreDevToolsEnabled = false;
#endif
        // Lets the page offer what only this app can do (installing official programs).
        settings.UserAgent += " EstrellaDesktop/" + AppInfo.DisplayVersion;

        core.NavigationStarting += (_, e) =>
        {
            var decision = policy.TopLevel(e.Uri);
            if (decision == NavigationDecision.Allow) return;
            e.Cancel = true;
            if (decision == NavigationDecision.OpenInBrowser) OpenInBrowser(e.Uri);
        };
        core.FrameNavigationStarting += (_, e) =>
        {
            if (policy.Frame(e.Uri) != NavigationDecision.Allow) e.Cancel = true;
        };
        core.NewWindowRequested += (_, e) =>
        {
            e.Handled = true;
            if (policy.NewWindow(e.Uri) == NavigationDecision.OpenInBrowser) OpenInBrowser(e.Uri);
        };
        core.SourceChanged += (_, _) => ShowWhereWeAre(core.Source);
        core.PermissionRequested += (_, e) =>
        {
            if (Array.IndexOf(Denied, e.PermissionKind) >= 0) e.State = CoreWebView2PermissionState.Deny;
        };
        core.WebMessageReceived += OnWebMessage;
        core.ProcessFailed += (_, e) =>
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                MessageBox.Show(this, "ESTRELLA se cerró de forma inesperada. Tu trabajo está guardado: ábrela otra vez.", AppInfo.Name,
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                Close();
            }
            else
            {
                core.Reload();
            }
        };
    }

    /// <summary>Outside ESTRELLA (for example, OpenRouter's sign-in), the window says where it is.</summary>
    private void ShowWhereWeAre(string source)
    {
        var away = Uri.TryCreate(source, UriKind.Absolute, out var url) && (url.Scheme == Uri.UriSchemeHttps || url.Scheme == Uri.UriSchemeHttp) && !policy.IsApp(url);
        awayBar.Visible = away;
        awayLabel.Text = away ? $"Estás en {url!.Host}, fuera de ESTRELLA." : "";
        Text = away ? $"{url!.Host} · {AppInfo.Name}" : AppInfo.Name;
    }

    private void OnWebMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        if (!policy.AcceptsMessagesFrom(e.Source)) return;
        string? message;
        try
        {
            message = e.TryGetWebMessageAsString();
        }
        catch (ArgumentException)
        {
            return; // Not a string: not ours.
        }
        var tool = BridgeMessages.ToolToInstall(message);
        if (tool is null) return;
        var program = OfficialPrograms.Find(tool);
        if (program is null)
        {
            Reply("rejected", tool);
            return;
        }
        var answer = MessageBox.Show(this,
            $"¿Instalar {program.Name} en este equipo?\n\n"
            + $"Se descargará con winget desde su fuente oficial ({program.Site}), y winget comprueba que el archivo no fue alterado. "
            + "Se abrirá una ventana con el progreso, y Windows puede pedir permiso de administrador.\n\n"
            + $"{program.Name} es un programa aparte, con su propia licencia: no es parte de ESTRELLA.",
            "Instalar un programa oficial", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
        if (answer != DialogResult.Yes)
        {
            Reply("cancelled", tool);
            return;
        }
        try
        {
            Process.Start(new ProcessStartInfo("winget.exe", OfficialPrograms.WingetArguments(program)) { UseShellExecute = true })?.Dispose();
            Reply("started", tool);
        }
        catch (Win32Exception)
        {
            // Older Windows without winget: the official page is the way.
            Reply("unavailable", tool);
            OpenInBrowser(program.Site);
        }
    }

    private void Reply(string outcome, string tool) => view.CoreWebView2?.PostWebMessageAsString(BridgeMessages.Reply(outcome, tool));

    private static void OpenInBrowser(string url)
    {
        Process.Start(new ProcessStartInfo(url) { UseShellExecute = true })?.Dispose();
    }
}
