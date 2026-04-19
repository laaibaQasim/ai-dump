#!/usr/bin/env node

/**
 * Fires on afterAgentResponse. Scans the agent reply for a ### Session Log block
 * and, if found, appends a timestamped entry to session_logs on the open session record.
 */

const path = require("path");
const {
  loadTrackerConfig,
  isSessionTrackingEnabled,
  resolveStoreFileForToday,
  readStore,
  writeStoreAtomic,
  findOpenSessionIndex,
  findLastSessionIndexById,
  extractSessionLog,
  getBranchName,
  getProjectName,
  resolveProjectPath,
  readStdinJson,
} = require("../../.claude/hooks/session-tracker-utils");

const CONFIG_PATH = path.resolve(__dirname, "../config.json");

function main() {
  const input = readStdinJson("cursor:capture-summary");
  const config = loadTrackerConfig(CONFIG_PATH);

  if (!isSessionTrackingEnabled(config)) {
    process.stdout.write("{}\n");
    return;
  }

  const sessionId = input.session_id || null;
  const responseText = input.text || null;

  if (!sessionId || !responseText || typeof responseText !== "string") {
    process.stdout.write("{}\n");
    return;
  }

  const sessionLog = extractSessionLog(responseText);
  if (!sessionLog) {
    process.stdout.write("{}\n");
    return;
  }

  const STORE_PATH = resolveStoreFileForToday(config);
  const store = readStore(STORE_PATH);
  if (!Array.isArray(store.sessions)) store.sessions = [];

  let idx = findOpenSessionIndex(store.sessions, sessionId);
  if (idx < 0) {
    idx = findLastSessionIndexById(store.sessions, sessionId);
    if (idx >= 0) {
      store.sessions[idx].ended_at = null;
      store.sessions[idx].duration_minutes = null;
    }
  }
  if (idx < 0) {
    const cwd = process.cwd();
    store.sessions.push({
      session_id: sessionId,
      tool: "cursor",
      started_at: new Date().toISOString(),
      project_name: getProjectName(cwd),
      project_path: resolveProjectPath(cwd),
      branch_name: getBranchName(cwd),
      ended_at: null,
      duration_minutes: null,
      session_logs: [],
    });
    idx = store.sessions.length - 1;
  }

  const row = store.sessions[idx];

  const entry = { captured_at: new Date().toISOString(), ...sessionLog };
  row.session_logs = Array.isArray(row.session_logs) ? [...row.session_logs, entry] : [entry];

  writeStoreAtomic(STORE_PATH, store);
  process.stdout.write("{}\n");
}

main();
