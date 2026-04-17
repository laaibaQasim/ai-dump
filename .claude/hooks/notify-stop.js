#!/usr/bin/env node

const fs = require("fs");
const { execFileSync } = require("child_process");
const path = require("path");

function loadConfig() {
  try {
    const configPath = path.join(__dirname, "../config.json");
    return JSON.parse(fs.readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function readInput() {
  return fs.readFileSync(0, "utf8");
}

function getFrontmostApp() {
  try {
    return execFileSync(
      "osascript",
      [
        "-e",
        'tell application "System Events" to get name of first application process whose frontmost is true',
      ],
      { encoding: "utf8" },
    ).trim();
  } catch {
    return "";
  }
}

function shouldNotify() {
  const frontmostApp = getFrontmostApp();

  const appsToSuppressFor = [
    "Cursor",
    "Terminal",
    "Visual Studio Code",
    "Code",
    "iTerm2",
    "Warp",
  ];

  return !appsToSuppressFor.includes(frontmostApp);
}

function notify(title, message, sound) {
  try {
    execFileSync("osascript", [
      "-e",
      `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`,
    ]);

    execFileSync("afplay", [sound]);
  } catch {}
}

function main() {
  let input = {};

  try {
    const raw = readInput();
    input = raw ? JSON.parse(raw) : {};
  } catch {
    process.stdout.write("{}\n");
    return;
  }

  const config = loadConfig();

  if (!config || !config.enabled) {
    process.stdout.write("{}\n");
    return;
  }

  const hookConfig = config.hooks?.task_done;
  if (!hookConfig || !hookConfig.enabled) {
    process.stdout.write("{}\n");
    return;
  }

  if (!shouldNotify()) {
    process.stdout.write("{}\n");
    return;
  }

  const soundPath = path.join(__dirname, "../sounds", hookConfig.sound);
  notify("Claude", "Task completed", soundPath);
  process.stdout.write("{}\n");
}

main();
