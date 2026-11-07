using System;
using System.Diagnostics;
using System.Drawing;
using System.Windows.Forms;

namespace Estrella.Desktop;

/// <summary>
/// The installer's conversations with the student. With <c>--silent</c> nothing is asked (scripts,
/// automated tests, IT departments) and the result is the exit code.
/// </summary>
internal static class Setup
{
    private const string Title = "ESTRELLA";

    public static int Install(InstallLayout layout, string runningExe, bool silent)
    {
        var installed = Installer.InstalledVersion();
        if (!silent && !InstallLayout.IsNewer(AppInfo.DisplayVersion, installed))
        {
            // Same or newer version already there: just open it.
            var open = MessageBox.Show($"ESTRELLA {installed} ya está instalada en este equipo. ¿Abrirla ahora?", Title,
                MessageBoxButtons.YesNo, MessageBoxIcon.Information);
            if (open == DialogResult.Yes) Launch(layout);
            return 0;
        }
        if (!silent)
        {
            var text = installed is null
                ? $"¿Instalar ESTRELLA {AppInfo.DisplayVersion} en este equipo?\n\n"
                  + "Se instala solo para tu usuario, sin permisos de administrador, y aparece en el menú Inicio.\n"
                  + "Se desinstala desde Configuración > Aplicaciones."
                : $"¿Actualizar ESTRELLA de la versión {installed} a la {AppInfo.DisplayVersion}?\n\nTus proyectos se conservan.";
            if (MessageBox.Show(text, Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return 1;
        }
        while (Installer.AppIsRunning())
        {
            if (silent) return 2;
            var retry = MessageBox.Show("ESTRELLA está abierta. Ciérrala para continuar; tu trabajo ya está guardado.", Title,
                MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
            if (retry != DialogResult.Retry) return 1;
        }
        Installer.Install(layout, runningExe);
        if (!silent) Launch(layout);
        return 0;
    }

    public static int Uninstall(InstallLayout layout, bool silent, bool deleteData)
    {
        if (!silent)
        {
            using var dialog = new UninstallDialog(layout);
            if (dialog.ShowDialog() != DialogResult.OK) return 1;
            deleteData = dialog.DeleteData;
        }
        while (Installer.AppIsRunning())
        {
            if (silent) return 2;
            var retry = MessageBox.Show("ESTRELLA está abierta. Ciérrala para desinstalar.", Title, MessageBoxButtons.RetryCancel, MessageBoxIcon.Warning);
            if (retry != DialogResult.Retry) return 1;
        }
        Installer.Uninstall(layout, deleteData);
        if (!silent)
        {
            MessageBox.Show(deleteData
                ? "ESTRELLA se desinstaló y se borraron sus datos de este equipo."
                : $"ESTRELLA se desinstaló. Tus datos siguen en {layout.DataDir}: si la vuelves a instalar, ahí estarán.",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        return 0;
    }

    private static void Launch(InstallLayout layout)
    {
        Process.Start(new ProcessStartInfo(layout.ExePath) { UseShellExecute = true, WorkingDirectory = layout.InstallDir })?.Dispose();
    }

    /// <summary>Uninstalling keeps the data unless the student checks the box: it is their work.</summary>
    private sealed class UninstallDialog : Form
    {
        private readonly CheckBox deleteData;

        public UninstallDialog(InstallLayout layout)
        {
            Text = "Desinstalar ESTRELLA";
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            Padding = new Padding(16);
            Font = SystemFonts.MessageBoxFont;

            var layoutPanel = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false };
            layoutPanel.Controls.Add(new Label
            {
                AutoSize = true,
                MaximumSize = new Size(460, 0),
                Text = "Se quitará ESTRELLA de este equipo.\n\n"
                       + "Los proyectos guardados solo en este equipo están en " + layout.DataDir + ". "
                       + "Si no los borras, aparecerán otra vez al reinstalar. Los que tengas en la nube siguen en tu cuenta.",
            });
            deleteData = new CheckBox { AutoSize = true, Text = "Borrar también mis datos de este equipo (no se puede deshacer)", Margin = new Padding(0, 12, 0, 12) };
            layoutPanel.Controls.Add(deleteData);
            var buttons = new FlowLayoutPanel { FlowDirection = FlowDirection.RightToLeft, AutoSize = true, Dock = DockStyle.Fill };
            var cancel = new Button { Text = "Cancelar", DialogResult = DialogResult.Cancel, AutoSize = true };
            var ok = new Button { Text = "Desinstalar", DialogResult = DialogResult.OK, AutoSize = true };
            buttons.Controls.Add(cancel);
            buttons.Controls.Add(ok);
            layoutPanel.Controls.Add(buttons);
            Controls.Add(layoutPanel);
            AcceptButton = ok;
            CancelButton = cancel;
        }

        public bool DeleteData => deleteData.Checked;
    }
}
