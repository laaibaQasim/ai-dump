#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { playSound, notify, shouldNotify } = require("./platform");

function loadConfig() {
  const configPath = path.join(__dirname, "../config.json");

  try {
    const raw = fs.readFileSync(configPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function main() {
  let input = {};

  try {
    const raw = fs.readFileSync(0, "utf8");
    input = raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    process.stdout.write("{}\n");
    return;
  }

  const config = loadConfig();
  const hookConfig = config?.hooks?.task_failed;

  if (!config?.enabled || !hookConfig?.enabled || !shouldNotify()) {
    process.stdout.write("{}\n");
    return;
  }

  const soundsDir = config.sounds_directory
    ? path.resolve(__dirname, "../..", config.sounds_directory)
    : path.join(__dirname, "../sounds");

  const soundPath = path.join(soundsDir, hookConfig.sound || "");

  try {
    notify("Claude", "Task failed");

    if (hookConfig.sound) {
      playSound(soundPath);
    }
  } catch (err) {
    console.error("[Hook Error] Notification failed:", err.message);
  }

  process.stdout.write("{}\n");
}

main();
