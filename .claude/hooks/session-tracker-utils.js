/**
 * Shared helpers for SessionStart / SessionEnd work tracking.
 * No external dependencies; paths are resolved from this repo's .claude layout.
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execFileSync } = require("child_process");


const TRACKER_VERSION = 1;

/**
 * Read JSON from stdin (hook payloads). Returns {} on empty input or parse error.
 * @param {string} [debugLabel] - Logged as `[label] ` when DEBUG=1 (e.g. `"cursor:session-end"`).
 */
function readStdinJson(debugLabel) {
  try {
    const raw = fs.readFileSync(0, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    if (process.env.DEBUG) {
      const tag = debugLabel ? `[${debugLabel}] ` : "";
      process.stderr.write(`${tag}stdin parse error: ${err.message}\n`);
    }
    return {};
  }
}

function parseIsoMs(iso) {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** Duration in minutes between two ISO timestamps, or null if invalid. */
function computeDuration(startedAt, endedAt) {
  const startMs = parseIsoMs(startedAt);
  const endMs = parseIsoMs(endedAt);
  if (startMs != null && endMs != null && endMs >= startMs) {
    return Math.round(((endMs - startMs) / 60000) * 100) / 100;
  }
  return null;
}

function tryExecGit(cwd, args) {
  try {
    return (
      execFileSync("git", args, {
        cwd: cwd || undefined,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      })?.trim() || ""
    );
  } catch {
    return "";
  }
}

function getBranchName(cwd) {
  if (!cwd) return null;
  const b = tryExecGit(cwd, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return b || null;
}

function readPackageName(cwd) {
  if (!cwd) return null;
  try {
    const p = path.join(cwd, "package.json");
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    if (j && typeof j.name === "string" && j.name.trim()) return j.name.trim();
  } catch {
    /* ignore */
  }
  return null;
}

function getProjectName(cwd) {
  if (!cwd) return null;
  const fromPkg = readPackageName(cwd);
  if (fromPkg) return fromPkg;
  try {
    return path.basename(path.resolve(cwd)) || null;
  } catch {
    return null;
  }
}

function resolveProjectPath(cwd) {
  if (!cwd) return null;
  try {
    return path.resolve(cwd);
  } catch {
    return null;
  }
}

const DEFAULT_STORE_DIR = "work-logs";
const DEFAULT_STORE_PREFIX = "session-work-log";

function getProjectRoot() {
  try {
    return fs.realpathSync(path.resolve(__dirname, "../.."));
  } catch {
    return path.resolve(__dirname, "../..");
  }
}

function loadTrackerConfig(configPath) {
  const resolved = configPath || path.join(__dirname, "../config.json");
  try {
    const raw = fs.readFileSync(resolved, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code !== "ENOENT" && process.env.DEBUG) {
      process.stderr.write(
        `[session-tracker] loadTrackerConfig failed for ${resolved}: ${err.message}\n`,
      );
    }
    return null;
  }
}

/**
 * Resolves the directory where daily log files are stored.
 * Falls back to <projectRoot>/work-logs if unconfigured.
 */
function resolveStoreDirectory(config) {
  const projectRoot = getProjectRoot();
  const rel = config?.session_tracking?.store_directory;
  const dirName = (typeof rel === "string" && rel.trim()) || DEFAULT_STORE_DIR;

  let resolved = path.isAbsolute(dirName)
    ? dirName
    : path.resolve(projectRoot, dirName);

  try {
    if (fs.existsSync(resolved)) {
      resolved = fs.realpathSync(resolved);
    }
  } catch {
    /* dir may not exist yet */
  }

  if (!resolved.startsWith(projectRoot + path.sep) && resolved !== projectRoot) {
    process.stderr.write(
      `[session-tracker] store_directory "${dirName}" escapes project root; using default\n`,
    );
    return path.resolve(projectRoot, DEFAULT_STORE_DIR);
  }
  return resolved;
}

function getStorePrefix(config) {
  const p = config?.session_tracking?.store_name_prefix;
  return (typeof p === "string" && p.trim()) || DEFAULT_STORE_PREFIX;
}

/**
 * Returns today's date as YYYY-MM-DD in the local timezone.
 */
function todayDateString() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Builds the full path for a given date's log file.
 */
function buildStoreFilePath(config, dateStr) {
  const dir = resolveStoreDirectory(config);
  const prefix = getStorePrefix(config);
  return path.join(dir, `${prefix}-${dateStr}.json`);
}

/**
 * Returns the store file path for today.
 */
function resolveStoreFileForToday(config) {
  return buildStoreFilePath(config, todayDateString());
}

function isSessionTrackingEnabled(config) {
  const st = config?.session_tracking;
  if (!st || typeof st !== "object") return false;
  return st.enabled === true;
}

/**
 * If the store file exists but is not valid JSON, move it aside so history is not
 * silently discarded. Returns true if the file was archived (or missing).
 */
function archiveCorruptStoreFile(storePath, err) {
  const base = path.basename(storePath);
  const dest = path.join(
    path.dirname(storePath),
    `${base}.corrupt.${Date.now()}.bak`,
  );
  try {
    fs.renameSync(storePath, dest);
    process.stderr.write(
      `[session-tracker] ${base} was invalid JSON (${err.message}); preserved as ${path.basename(dest)}\n`,
    );
    if (process.env.DEBUG) {
      process.stderr.write(`[session-tracker] readStore: ${String(err.stack || err)}\n`);
    }
    return true;
  } catch (moveErr) {
    process.stderr.write(
      `[session-tracker] CRITICAL: could not archive corrupt ${base} (${moveErr.message}). ` +
        `Repair or rename the file manually before the next session write.\n`,
    );
    if (process.env.DEBUG) {
      process.stderr.write(`[session-tracker] archiveCorruptStoreFile: ${String(moveErr.stack || moveErr)}\n`);
    }
    return false;
  }
}

function readStore(storePath) {
  try {
    const raw = fs.readFileSync(storePath, "utf8");
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("invalid root");
    if (!Array.isArray(data.sessions)) data.sessions = [];
    if (data.version == null) data.version = TRACKER_VERSION;
    return data;
  } catch (err) {
    if (err.code === "ENOENT") {
      return { version: TRACKER_VERSION, sessions: [] };
    }
    if (fs.existsSync(storePath)) {
      archiveCorruptStoreFile(storePath, err);
    } else if (process.env.DEBUG) {
      process.stderr.write(`[session-tracker] readStore failed: ${err.message}\n`);
    }
    return { version: TRACKER_VERSION, sessions: [] };
  }
}

function writeStoreAtomic(storePath, data) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  const payload = {
    ...data,
    version: TRACKER_VERSION,
    updated_at: new Date().toISOString(),
  };
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2), {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.renameSync(tmp, storePath);
  } catch (renameErr) {
    let copyErr;
    try {
      fs.copyFileSync(tmp, storePath);
    } catch (e) {
      copyErr = e;
    }
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (copyErr) {
      process.stderr.write(
        `[session-tracker] CRITICAL: atomic write failed for ${path.basename(storePath)} ` +
          `(rename: ${renameErr.message}, copy: ${copyErr.message}). Data may be lost.\n`,
      );
    }
  }
}

function findOpenSessionIndex(sessions, sessionId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    const s = sessions[i];
    if (s && s.session_id === sessionId && !s.ended_at) return i;
  }
  return -1;
}

/**
 * Find the most recent session with a given ID, regardless of open/closed state.
 * Returns the index or -1.
 */
function findLastSessionIndexById(sessions, sessionId) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i] && sessions[i].session_id === sessionId) return i;
  }
  return -1;
}

const FALLBACK_STALE_DAYS = 7;
/**
 * Auto-close sessions older than staleDays that were never finalized.
 * Returns the number of sessions closed.
 */
function closeStaleOpenSessions(sessions, staleDays) {
  const days =
    typeof staleDays === "number" && staleDays > 0
      ? staleDays
      : FALLBACK_STALE_DAYS;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  let closed = 0;
  for (const s of sessions) {
    if (!s || s.ended_at) continue;
    const startMs = Date.parse(s.started_at);
    if (!Number.isNaN(startMs) && startMs < cutoff) {
      s.ended_at = s.started_at;
      s.duration_minutes = 0;
      closed++;
    }
  }
  return closed;
}

/**
 * Remove leftover .tmp files from previous crashed writes.
 */
function cleanupOrphanedTmpFiles(storePath) {
  try {
    const dir = path.dirname(storePath);
    const base = path.basename(storePath);
    const entries = fs.readdirSync(dir);
    for (const name of entries) {
      if (name.startsWith(base) && name.endsWith(".tmp")) {
        try {
          fs.unlinkSync(path.join(dir, name));
        } catch {
          /* ignore */
        }
      }
    }
  } catch {
    /* ignore */
  }
}

function normalizeOneLine(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max) {
  const t = normalizeOneLine(text);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

/**
 * Recursively collect text from Anthropic-style content blocks.
 * Preserves newlines so downstream heading detection (e.g. "Summary:")
 * can match at the start of a line.
 */
function collectTextFromContent(content, out) {
  if (content == null) return;
  if (typeof content === "string") {
    const trimmed = content.trim();
    if (trimmed) out.push(trimmed);
    return;
  }
  if (Array.isArray(content)) {
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string") {
        collectTextFromContent(block.text, out);
      } else if (block.type === "tool_use" || block.type === "tool_result") {
        continue;
      } else if (typeof block.text === "string") {
        collectTextFromContent(block.text, out);
      } else if (block.content) {
        collectTextFromContent(block.content, out);
      }
    }
    return;
  }
  if (typeof content === "object") {
    if (typeof content.text === "string") collectTextFromContent(content.text, out);
    if (Array.isArray(content.content))
      collectTextFromContent(content.content, out);
  }
}

function normalizeDialogueRole(value) {
  const r = String(value || "")
    .trim()
    .toLowerCase();
  if (
    r === "user" ||
    r === "human" ||
    r === "humanmessage" ||
    r === "human_message"
  ) {
    return "user";
  }
  if (
    r === "assistant" ||
    r === "ai" ||
    r === "model" ||
    r === "assistantmessage"
  ) {
    return "assistant";
  }
  return null;
}

/**
 * Best-effort: Claude Code JSONL varies by version. We only pull plain dialogue text.
 * Unsupported shapes yield empty turns (caller should treat summary as low confidence).
 */
function extractTurnFromLine(obj) {
  if (!obj || typeof obj !== "object") return null;

  const topType = obj.type;
  if (topType === "tool_use" || topType === "tool_result") return null;

  let role = null;

  if (topType === "user" || topType === "human") role = "user";
  else if (topType === "assistant") role = "assistant";

  const msg = obj.message;

  if (topType === "message" && msg && typeof msg === "object") {
    role =
      role ||
      normalizeDialogueRole(msg.role) ||
      normalizeDialogueRole(msg.type);
  }

  if (typeof msg === "string") {
    const text = normalizeOneLine(msg);
    if (!text || !role) return null;
    return { role, text };
  }

  if (msg && typeof msg === "object") {
    if (!role) {
      role =
        normalizeDialogueRole(msg.role) ||
        normalizeDialogueRole(msg.type) ||
        (typeof msg.name === "string" ? normalizeDialogueRole(msg.name) : null);
    }
  }

  if (!role && typeof obj.role === "string") {
    role = normalizeDialogueRole(obj.role);
  }

  const parts = [];

  if (msg && typeof msg === "object") {
    if (typeof msg.content !== "undefined") collectTextFromContent(msg.content, parts);
    else if (typeof msg.text === "string") collectTextFromContent(msg.text, parts);
  }

  if (!parts.length && typeof obj.content !== "undefined") {
    collectTextFromContent(obj.content, parts);
  }
  if (!parts.length && typeof obj.text === "string") {
    collectTextFromContent(obj.text, parts);
  }

  const text = parts.join("\n").trim();
  if (!text) return null;
  if (!role) return null;

  return { role, text };
}

/**
 * Best-effort JSONL transcript parser (Claude Code–oriented). Not a guarantee of full
 * session fidelity; tool-only lines and unknown schemas are skipped.
 */
async function loadConversationTurns(transcriptPath) {
  const turns = [];
  if (!transcriptPath) return { turns, tool_use_lines: 0, parse_errors: 0 };

  let toolUseLines = 0;
  let parseErrors = 0;

  const stream = fs.createReadStream(transcriptPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      parseErrors++;
      continue;
    }
    const tt = obj?.type;
    if (
      tt === "tool_use" ||
      tt === "tool_result" ||
      tt === "tool_use_result" ||
      tt === "function_call" ||
      tt === "function_call_result"
    ) {
      toolUseLines++;
      continue;
    }
    const turn = extractTurnFromLine(obj);
    if (turn) turns.push(turn);
  }

  return { turns, tool_use_lines: toolUseLines, parse_errors: parseErrors };
}

/**
 * Recognizes Summary section starters (Markdown ##, plain Summary:, **Summary:**, etc.).
 * Returns { sameLineBody } when the heading has optional text after it on the same line.
 */
function parseSummaryHeadingLine(trimmed) {
  if (!trimmed) return null;

  if (/^#{1,6}\s*Summary\b/i.test(trimmed)) {
    return { sameLineBody: "" };
  }
  if (/^\*\*\s*Summary\s*\*\*\s*$/i.test(trimmed)) {
    return { sameLineBody: "" };
  }
  /**
   * Documented heading: `**Summary:**` (bold wraps "Summary:" — colon then closing **).
   * Optional text after the closing ** on the same line is part of the body.
   */
  const boldSummaryLabel = trimmed.match(/^\*\*\s*Summary\s*:\s*\*\*\s*(.*)$/i);
  if (boldSummaryLabel) {
    return { sameLineBody: (boldSummaryLabel[1] || "").trim() };
  }
  const plain = trimmed.match(/^Summary\s*:\s*(.*)$/i);
  if (plain) {
    return { sameLineBody: (plain[1] || "").trim() };
  }
  return null;
}

function isSummaryHeadingLine(trimmed) {
  return parseSummaryHeadingLine(trimmed) != null;
}

function markdownHeadingLevel(trimmed) {
  const m = trimmed.match(/^(#{1,6})(\s|$)/);
  return m ? m[1].length : 0;
}

/**
 * Returns body text after a Summary heading, or null.
 */
function extractBodyAfterSummaryHeading(text) {
  const lines = String(text || "").split(/\r?\n/);
  let i = 0;
  let found = false;
  let sameLinePrefix = "";
  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    const parsed = parseSummaryHeadingLine(t);
    if (parsed) {
      sameLinePrefix = parsed.sameLineBody || "";
      i++;
      found = true;
      break;
    }
  }
  if (!found) return null;

  const summaryLine = lines[i - 1].trim();
  const summaryLevel = markdownHeadingLevel(summaryLine) || 2;

  const body = [];
  if (sameLinePrefix) {
    body.push(sameLinePrefix);
  }
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    const hl = markdownHeadingLevel(t);
    if (hl > 0 && hl <= summaryLevel && !isSummaryHeadingLine(t)) {
      break;
    }
    body.push(raw);
  }
  const joined = body.join("\n").trim();
  return joined || null;
}

// =============================================================================
// Session Log extraction (structured fields)
// =============================================================================

const SESSION_LOG_FIELDS = {
  "user intent": "user_intent",
  "prompt summary": "prompt_summary",
  "provided context": "provided_context",
  "what i did": "what_i_did",
  "open issues": "open_issues",
  "next best step": "next_best_step",
};

function isSessionLogHeadingLine(trimmed) {
  return (
    /^#{1,6}\s*Session\s+Log\b/i.test(trimmed) ||
    /^\*\*\s*Session\s+Log\s*\*\*/i.test(trimmed)
  );
}

/**
 * Extracts structured Session Log fields from response text.
 * Looks for a `### Session Log` heading, then parses `- **Field:** value` lines.
 * Returns an object with snake_case keys, or null if no Session Log found.
 */
function extractSessionLog(text) {
  const lines = String(text || "").split(/\r?\n/);
  let i = 0;
  let found = false;

  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (isSessionLogHeadingLine(t)) {
      i++;
      found = true;
      break;
    }
  }

  if (!found) return null;

  const result = {};
  const headingLevel = 3;

  for (; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) continue;

    const hl = markdownHeadingLevel(t);
    if (hl > 0 && hl <= headingLevel && !isSessionLogHeadingLine(t)) break;

    // Match: - **Field Name:** value  OR  **Field Name:** value
    const m = t.match(/^[-*•]?\s*\*\*([^*]+?):\*\*\s*(.*)/);
    if (m) {
      const label = m[1].trim().toLowerCase();
      const value = m[2].trim();
      const key = SESSION_LOG_FIELDS[label];
      if (key && value) result[key] = value;
    }
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Scans all assistant turns for Session Log blocks.
 * Returns an array of raw log objects (one per turn that has a Session Log),
 * oldest-to-newest. Timestamps are added by the caller. Returns null if none found.
 */
function tryExtractSessionLog(turns) {
  if (!turns || !turns.length) return null;
  const logs = [];
  for (const turn of turns) {
    if (turn.role !== "assistant") continue;
    const log = extractSessionLog(turn.text);
    if (log) logs.push(log);
  }
  return logs.length > 0 ? logs : null;
}

module.exports = {
  TRACKER_VERSION,
  readStdinJson,
  parseIsoMs,
  computeDuration,
  getBranchName,
  getProjectName,
  resolveProjectPath,
  loadTrackerConfig,
  resolveStoreDirectory,
  resolveStoreFileForToday,
  buildStoreFilePath,
  todayDateString,
  isSessionTrackingEnabled,
  readStore,
  writeStoreAtomic,
  findOpenSessionIndex,
  findLastSessionIndexById,
  closeStaleOpenSessions,
  cleanupOrphanedTmpFiles,
  loadConversationTurns,
  truncate,
  parseSummaryHeadingLine,
  extractBodyAfterSummaryHeading,
  SESSION_LOG_FIELDS,
  isSessionLogHeadingLine,
  extractSessionLog,
  tryExtractSessionLog,
};
