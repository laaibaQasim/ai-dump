#!/usr/bin/env node

const path = require("path");
const {
  loadTrackerConfig,
  isSessionTrackingEnabled,
  buildStoreFilePath,
  readStore,
  writeStoreAtomic,
  findOpenSessionIndex,
  findLastSessionIndexById,
  closeStaleOpenSessions,
  cleanupOrphanedTmpFiles,
  getBranchName,
  getProjectName,
  resolveProjectPath,
  readStdinJson,
} = require("../../.claude/hooks/session-tracker-utils");

const CONFIG_PATH = path.resolve(__dirname, "../config.json");

function main() {
  const input = readStdinJson("cursor:session-start");
  const config = loadTrackerConfig(CONFIG_PATH);

  if (!isSessionTrackingEnabled(config)) {
    process.stdout.write("{}\n");
    return;
  }

  const todayStorePath = buildStoreFilePath(config);
  const sessionId = input.session_id || null;
  const cwd = input.cwd || process.cwd();
  const model = input.model || null;
  const now = new Date().toISOString();

  cleanupOrphanedTmpFiles(todayStorePath);

  const store = readStore(todayStorePath);
  if (!Array.isArray(store.sessions)) store.sessions = [];

  closeStaleOpenSessions(store.sessions, config?.session_tracking?.stale_session_days);

  if (!sessionId) {
    if (process.env.DEBUG) {
      process.stderr.write("[cursor:session-start] missing session_id; skipping write\n");
    }
    process.stdout.write("{}\n");
    return;
  }

  // Check today's file for any existing session (open or closed) with this ID
  let existingIdx = findOpenSessionIndex(store.sessions, sessionId);
  if (existingIdx < 0) {
    existingIdx = findLastSessionIndexById(store.sessions, sessionId);
  }

  if (existingIdx >= 0) {
    // Session exists in today's file — record resume event and reopen if closed
    const row = store.sessions[existingIdx];
    row.resume_events = row.resume_events || [];
    row.resume_events.push({ at: now, source: input.source ?? null });
    if (row.ended_at) {
      row.ended_at = null;
      row.duration_minutes = null;
    }
    writeStoreAtomic(todayStorePath, store);
    process.stdout.write("{}\n");
    return;
  }

  // New session — write to today's file
  store.sessions.push({
    session_id: sessionId,
    tool: "cursor",
    model,
    started_at: now,
    project_name: getProjectName(cwd),
    project_path: resolveProjectPath(cwd),
    branch_name: getBranchName(cwd),
    ended_at: null,
    duration_minutes: null,
    session_logs: [],
  });

  writeStoreAtomic(todayStorePath, store);
  process.stdout.write("{}\n");
}

main();
