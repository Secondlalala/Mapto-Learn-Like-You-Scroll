using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Windows.Forms;

namespace MapToLearnDesktop
{
    internal sealed class ControlForm : Form
    {
        private const int BackendPort = 8000;
        private const int FrontendPort = 5173;
        private readonly string controllerScript;
        private readonly Label statusLabel;
        private readonly Label messageLabel;
        private readonly Button startButton;
        private readonly Button stopButton;
        private readonly Button openButton;
        private readonly Timer statusTimer;
        private string pendingAction;
        private DateTime actionStartedAt;
        private bool openAfterStart;

        public ControlForm()
        {
            controllerScript = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "MapToLearnControl.ps1");
            Text = "MapToLearn 应用控制";
            ClientSize = new Size(430, 270);
            StartPosition = FormStartPosition.CenterScreen;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            TopMost = true;
            BackColor = Color.FromArgb(247, 247, 245);
            Font = new Font("Microsoft YaHei UI", 10F);

            var titleLabel = new Label
            {
                Text = "MapToLearn",
                Font = new Font("Microsoft YaHei UI", 19F, FontStyle.Bold),
                Location = new Point(24, 18),
                AutoSize = true
            };
            Controls.Add(titleLabel);

            statusLabel = new Label
            {
                Location = new Point(26, 66),
                Size = new Size(380, 52)
            };
            Controls.Add(statusLabel);

            startButton = CreateButton("启动应用", new Point(26, 132));
            startButton.BackColor = Color.FromArgb(32, 32, 30);
            startButton.ForeColor = Color.White;
            startButton.FlatStyle = FlatStyle.Flat;
            startButton.Click += delegate { BeginAction("Start"); };
            Controls.Add(startButton);

            stopButton = CreateButton("关闭应用", new Point(157, 132));
            stopButton.Click += delegate { BeginAction("Stop"); };
            Controls.Add(stopButton);

            openButton = CreateButton("打开网页", new Point(288, 132));
            openButton.Click += delegate { OpenWebApp(); };
            Controls.Add(openButton);

            messageLabel = new Label
            {
                Location = new Point(26, 218),
                Size = new Size(378, 34),
                ForeColor = Color.FromArgb(90, 90, 90)
            };
            Controls.Add(messageLabel);

            statusTimer = new Timer { Interval = 1000 };
            statusTimer.Tick += delegate { RefreshStatus(); };
            statusTimer.Start();
            FormClosed += delegate { statusTimer.Dispose(); };
            Shown += delegate { Activate(); BringToFront(); };
            RefreshStatus();
        }

        private static Button CreateButton(string text, Point location)
        {
            return new Button
            {
                Text = text,
                Location = location,
                Size = new Size(116, 48),
                UseVisualStyleBackColor = true
            };
        }

        private static bool IsPortOpen(int port)
        {
            try
            {
                return IPGlobalProperties.GetIPGlobalProperties()
                    .GetActiveTcpListeners()
                    .Any(endpoint => endpoint.Port == port);
            }
            catch
            {
                return false;
            }
        }

        private void RefreshStatus()
        {
            bool backendRunning = IsPortOpen(BackendPort);
            bool frontendRunning = IsPortOpen(FrontendPort);
            statusLabel.Text = string.Format(
                "后端：{0}\r\n前端：{1}",
                backendRunning ? "运行中" : "已关闭",
                frontendRunning ? "运行中" : "已关闭");

            bool actionPending = !string.IsNullOrEmpty(pendingAction);
            startButton.Enabled = !actionPending && !(backendRunning && frontendRunning);
            stopButton.Enabled = !actionPending && (backendRunning || frontendRunning);
            openButton.Enabled = frontendRunning;

            if (pendingAction == "Start" && backendRunning && frontendRunning)
            {
                pendingAction = null;
                messageLabel.Text = "应用已启动。";
                if (openAfterStart)
                {
                    openAfterStart = false;
                    OpenWebApp();
                }
            }
            else if (pendingAction == "Stop" && !backendRunning && !frontendRunning)
            {
                pendingAction = null;
                messageLabel.Text = "应用已关闭。";
            }
            else if (actionPending && DateTime.UtcNow - actionStartedAt > TimeSpan.FromSeconds(45))
            {
                pendingAction = null;
                openAfterStart = false;
                messageLabel.Text = "操作超时，请检查 MapToLearn 日志。";
            }
        }

        private void BeginAction(string action)
        {
            if (!File.Exists(controllerScript))
            {
                messageLabel.Text = "找不到控制脚本。";
                return;
            }

            pendingAction = action;
            actionStartedAt = DateTime.UtcNow;
            openAfterStart = action == "Start";
            messageLabel.Text = action == "Start" ? "正在启动，请稍候..." : "正在关闭...";
            RefreshStatus();

            try
            {
                string pwsh = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Programs", "PowerShell", "7", "pwsh.exe");
                if (!File.Exists(pwsh)) pwsh = "pwsh.exe";

                string arguments = string.Format(
                    "-NoProfile -ExecutionPolicy Bypass -File \"{0}\" -Action {1} -NoBrowser{2}",
                    controllerScript,
                    action,
                    action == "Start" ? " -KeepAlive" : string.Empty);
                Process.Start(new ProcessStartInfo
                {
                    FileName = pwsh,
                    Arguments = arguments,
                    WorkingDirectory = Path.GetDirectoryName(controllerScript),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden
                });
            }
            catch (Exception error)
            {
                pendingAction = null;
                openAfterStart = false;
                messageLabel.Text = error.Message;
                RefreshStatus();
            }
        }

        private void OpenWebApp()
        {
            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = "http://127.0.0.1:5173/",
                    UseShellExecute = true
                });
            }
            catch (Exception error)
            {
                messageLabel.Text = error.Message;
            }
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new ControlForm());
        }
    }
}
