#!/usr/bin/env node

const {
  loadTrackerConfig,
  resolveStoreFileForToday,
  isSessionTrackingEnabled,
  readStore,
  writeStoreAtomic,
  findLastSessionIndexById,
  loadConversationTurns,
  tryExtractSessionLog,
  readStdinJson,
  computeDuration,
} = require("./session-tracker-utils");

/**
 * Finalize a session row with all available data and persist it.
 * Re-reads the store to avoid clobbering concurrent writes.
 */
function finalizeSession(storePath, sessionId, updates) {
  const freshStore = readStore(storePath);
  if (!Array.isArray(freshStore.sessions)) freshStore.sessions = [];

  const freshIdx = findLastSessionIndexById(freshStore.sessions, sessionId);
  if (freshIdx < 0) {
    process.stderr.write(
      `[session-end] session ${sessionId} not found in store before finalize; ` +
        "saving as new record.\n",
    );
    freshStore.sessions.push({ session_id: sessionId, ...updates });
  } else {
    Object.assign(freshStore.sessions[freshIdx], updates);
  }

  writeStoreAtomic(storePath, freshStore);
}

async function main() {
  const input = readStdinJson("session-end");
  const config = loadTrackerConfig();

  if (!isSessionTrackingEnabled(config)) {
    process.stdout.write("{}\n");
    return;
  }

  const sessionId = input.session_id || null;
  const endedAt = new Date().toISOString();

  if (!sessionId) {
    process.stdout.write("{}\n");
    return;
  }

  // Always finalize in today's file (daily view: all activity on a given day goes in that day's file)
  const storePath = resolveStoreFileForToday(config);

  const store = readStore(storePath);
  if (!Array.isArray(store.sessions)) {
    process.stdout.write("{}\n");
    return;
  }

  const idx = findLastSessionIndexById(store.sessions, sessionId);
  if (idx < 0) {
    if (process.env.DEBUG) {
      process.stderr.write(
        `[session-end] no session for session_id=${sessionId}\n`,
      );
    }
    process.stdout.write("{}\n");
    return;
  }

  const row = store.sessions[idx];
  const totalDuration = computeDuration(row.started_at, endedAt);

  const transcriptPath = input.transcript_path || null;
  let sessionLogs = null;

  try {
    const parsed = await loadConversationTurns(transcriptPath);
    const found = tryExtractSessionLog(parsed.turns);
    if (found && found.length) {
      const now = new Date().toISOString();
      sessionLogs = found.map((log) => ({ captured_at: now, ...log }));
    }
  } catch (err) {
    process.stderr.write(
      `[session log] Could not read transcript (${err.message}); saving session with minimal data.\n`,
    );
  }

  if (!sessionLogs && process.env.DEBUG) {
    process.stderr.write(
      "[session log] No Session Log section found in assistant messages.\n",
    );
  }

  finalizeSession(storePath, sessionId, {
    ended_at: endedAt,
    duration_minutes: totalDuration,
    session_logs: sessionLogs,
  });

  process.stdout.write("{}\n");
}

main().catch((err) => {
  process.stderr.write(`[session-end] ${err.stack || err}\n`);
  process.stdout.write("{}\n");
  process.exit(0);
});
