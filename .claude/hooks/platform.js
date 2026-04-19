const fs = require("fs");
const { execFileSync } = require("child_process");

const IS_DARWIN = process.platform === "darwin";
const IS_LINUX = process.platform === "linux";
const IS_WIN32 = process.platform === "win32";

const commandCache = new Map();

function tryExec(cmd, args, options = {}) {
  try {
    return (
      execFileSync(cmd, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        ...options,
      })?.trim() || ""
    );
  } catch {
    return "";
  }
}

function commandExists(cmd) {
  if (commandCache.has(cmd)) return commandCache.get(cmd);
  const result = !!(IS_WIN32 ? tryExec("where", [cmd]) : tryExec("which", [cmd]));
  commandCache.set(cmd, result);
  return result;
}

function encodePSCommand(script) {
  return Buffer.from(script, "utf16le").toString("base64");
}

function psLiteral(str) {
  return "'" + String(str).replace(/'/g, "''") + "'";
}

function isAccessibleFile(filePath) {
  try {
    return fs.statSync(filePath).isFile(); // statSync() already fails if the file is not accessible or doesn’t exist
  } catch {
    return false;
  }
}

function playSound(soundPath) {
  if (!soundPath || !isAccessibleFile(soundPath)) return;

  try {
    if (IS_DARWIN && commandExists("afplay")) {
      execFileSync("afplay", [soundPath], { stdio: "ignore" });
      return;
    }

    if (IS_LINUX) {
      if (commandExists("ffplay")) {
        execFileSync(
          "ffplay",
          ["-nodisp", "-autoexit", "-loglevel", "quiet", soundPath],
          { stdio: "ignore" },
        );
        return;
      }

      if (commandExists("paplay")) {
        execFileSync("paplay", [soundPath], { stdio: "ignore" });
        return;
      }

      if (commandExists("aplay")) {
        execFileSync("aplay", [soundPath], { stdio: "ignore" });
        return;
      }

      if (commandExists("mpg123")) {
        execFileSync("mpg123", ["-q", soundPath], { stdio: "ignore" });
        return;
      }
    }

    if (IS_WIN32 && commandExists("powershell")) {
      const safePath = psLiteral(soundPath);
      const script =
        `Add-Type -AssemblyName presentationCore;` +
        `$player = New-Object System.Windows.Media.MediaPlayer;` +
        `$player.Open([Uri]${safePath});` +
        `$player.Play();` +
        `Start-Sleep -Seconds 5;` +
        `$player.Close();`;
      execFileSync(
        "powershell",
        ["-NoProfile", "-EncodedCommand", encodePSCommand(script)],
        { stdio: "ignore" },
      );
    }
  } catch (err) {
    if (process.env.DEBUG) {
      process.stderr.write(`[platform:playSound] ${err.message}\n`);
    }
  }
}

function escapeForAppleScript(str) {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function notify(title, message) {
  const safeTitle = escapeForAppleScript(
    String(title || "").replace(/[\x00-\x1f]/g, ""),
  );
  const safeMessage = escapeForAppleScript(
    String(message || "").replace(/[\x00-\x1f]/g, ""),
  );

  try {
    if (IS_DARWIN && commandExists("osascript")) {
      tryExec("osascript", [
        "-e",
        `display notification "${safeMessage}" with title "${safeTitle}"`,
      ]);
      return;
    }

    if (IS_LINUX && commandExists("notify-send")) {
      execFileSync("notify-send", [safeTitle, safeMessage], {
        stdio: "ignore",
      });
      return;
    }

    if (IS_WIN32 && commandExists("powershell")) {
      const psTitle = psLiteral(safeTitle);
      const psMsg = psLiteral(safeMessage);
      const script =
        `Add-Type -AssemblyName System.Windows.Forms;` +
        `Add-Type -AssemblyName System.Drawing;` +
        `$n = New-Object System.Windows.Forms.NotifyIcon;` +
        `$n.Icon = [System.Drawing.SystemIcons]::Information;` +
        `$n.Visible = $true;` +
        `$n.ShowBalloonTip(3000, ${psTitle}, ${psMsg}, 'Info');` +
        `Start-Sleep -Seconds 3;` +
        `$n.Dispose();`;
      execFileSync(
        "powershell",
        ["-NoProfile", "-EncodedCommand", encodePSCommand(script)],
        { stdio: "ignore" },
      );
      return;
    }
  } catch (err) {
    if (process.env.DEBUG) {
      process.stderr.write(`[platform:notify] ${err.message}\n`);
    }
  }
}

function getFrontmostApp() {
  if (IS_DARWIN && commandExists("osascript")) {
    return (
      tryExec("osascript", [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ]) || ""
    );
  }

  if (IS_LINUX) {
    if (!commandExists("xdotool")) return "";
    const windowId = tryExec("xdotool", ["getactivewindow"]);
    if (!windowId) return "";
    return tryExec("xdotool", ["getwindowname", windowId]) || "";
  }

  return "";
}

const SUPPRESS_LIST = [
  "cursor",
  "terminal",
  "visual studio code",
  "code",
  "iterm2",
  "warp",
  "gnome-terminal",
  "konsole",
  "xterm",
  "tilix",
  "powershell",
  "cmd",
  "windows terminal",
  "windowsterminal",
];

function shouldNotify() {
  const frontmost = getFrontmostApp().toLowerCase();
  if (!frontmost) return true;
  return !SUPPRESS_LIST.some((app) => frontmost.includes(app));
}

module.exports = {
  playSound,
  notify,
  shouldNotify,
};
