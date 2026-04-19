#!/usr/bin/env node

/**
 * Finalizes the open session when the Cursor agent stops.
 * First tries bullets already captured incrementally by capture-summary.js.
 * Falls back to scanning the transcript_path Cursor provides (same as Claude).
 */

const path = require("path");
const {
  loadTrackerConfig,
  isSessionTrackingEnabled,
  buildStoreFilePath,
  readStore,
  writeStoreAtomic,
  findLastSessionIndexById,
  loadConversationTurns,
  tryExtractSessionLog,
  readStdinJson,
  computeDuration,
} = require("../../.claude/hooks/session-tracker-utils");

const CONFIG_PATH = path.resolve(__dirname, "../config.json");

/**
 * Finalize a session row with all available data and persist it.
 * Re-reads the store to avoid clobbering concurrent writes (e.g. capture-summary.js).
 */
function finalizeSession(storePath, sessionId, updates) {
  const freshStore = readStore(storePath);
  if (!Array.isArray(freshStore.sessions)) freshStore.sessions = [];

  const freshIdx = findLastSessionIndexById(freshStore.sessions, sessionId);
  if (freshIdx < 0) {
    process.stderr.write(
      `[cursor:session-end] session ${sessionId} not found in store before finalize; ` +
        "saving as new record.\n",
    );
    freshStore.sessions.push({ session_id: sessionId, ...updates });
  } else {
    Object.assign(freshStore.sessions[freshIdx], updates);
  }

  writeStoreAtomic(storePath, freshStore);
}

async function main() {
  const input = readStdinJson("cursor:session-end");
  const config = loadTrackerConfig(CONFIG_PATH);

  if (!isSessionTrackingEnabled(config)) {
    process.stdout.write("{}\n");
    return;
  }

  const sessionId = input.session_id || null;
  const transcriptPath = input.transcript_path || null;
  const endedAt = new Date().toISOString();

  if (!sessionId) {
    process.stdout.write("{}\n");
    return;
  }

  // Always finalize in today's file (daily view: all activity on a given day goes in that day's file)
  const storePath = buildStoreFilePath(config);

  const store = readStore(storePath);
  if (!Array.isArray(store.sessions)) {
    process.stdout.write("{}\n");
    return;
  }

  const idx = findLastSessionIndexById(store.sessions, sessionId);
  if (idx < 0) {
    if (process.env.DEBUG) {
      process.stderr.write(`[cursor:session-end] no session for session_id=${sessionId}\n`);
    }
    process.stdout.write("{}\n");
    return;
  }

  const row = store.sessions[idx];
  const totalDuration = computeDuration(row.started_at, endedAt);

  // Use incrementally captured session_logs if available; otherwise fall back to transcript scan
  let sessionLogs =
    Array.isArray(row.session_logs) && row.session_logs.length ? row.session_logs : null;

  if (!sessionLogs && transcriptPath) {
    try {
      const { turns } = await loadConversationTurns(transcriptPath);
      const found = tryExtractSessionLog(turns);
      if (found && found.length) {
        const now = new Date().toISOString();
        sessionLogs = found.map((log) => ({ captured_at: now, ...log }));
      }
    } catch (err) {
      process.stderr.write(
        `[session log] Could not read transcript (${err.message}); saving session with minimal data.\n`,
      );
    }
  }

  if (!sessionLogs && process.env.DEBUG) {
    process.stderr.write(
      "[session log] No Session Log section found in assistant messages.\n",
    );
  }

  finalizeSession(storePath, sessionId, {
    ended_at: endedAt,
    duration_minutes: totalDuration,
    ...(sessionLogs && { session_logs: sessionLogs }),
  });

  process.stdout.write("{}\n");
}

main().catch((err) => {
  process.stderr.write(`[cursor:session-end] ${err.stack || err}\n`);
  process.stdout.write("{}\n");
  process.exit(0);
});
