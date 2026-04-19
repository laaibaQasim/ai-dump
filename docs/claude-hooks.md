# Claude Code hooks

## Overview

This package wires **Claude Code lifecycle events** to small Node scripts (no dependencies) defined in [`.claude/settings.json`](../.claude/settings.json).

Each hook:
- receives a **JSON payload on stdin**
- performs a focused task (log or notify)
- exits (stdout is `{}` where required by Claude)

Session logging shares logic with Cursor via [`session-tracker-utils.js`](../.claude/hooks/session-tracker-utils.js).

This document explains **what these hooks do in this repo**. For full event contracts, refer to Claude’s official docs.

---

## Hooks in this package

| Event | Script | What happens |
|------|--------|-------------|
| `SessionStart` | `session-start.js` | Starts or resumes a session log entry |
| `SessionEnd` | `session-end.js` | Finalizes the session and extracts `### Session Log` entries from the transcript |
| `Stop` | `notify-stop.js` | Notifies when a task completes |
| `StopFailure` | `notify-failure.js` | Notifies on failure |
| `PermissionRequest` | `notify-permission.js` | Notifies when approval is required |

---

## Behavior

### Session tracking

#### `SessionStart`
Triggered when a session starts or resumes.

- Creates or updates a session entry
- Records project, branch, and timestamps
- Adds a `resume_event` if the session was reopened
- No-op if `session_tracking.enabled = false`

---

#### `SessionEnd`
Triggered when a session ends.

- Marks session as completed (`ended_at`, duration)
- Reads the transcript via `transcript_path`
- Extracts every `### Session Log` block from assistant turns into **`session_logs`** (each entry includes `captured_at` plus the six structured fields)

There is **no** separate `capture-summary` hook for Claude Code in this repo; logging is finalized here unless you add one.

---

### Notifications

#### `Stop`
Runs after a successful response.

- Plays a sound
- Sends a desktop notification

---

#### `StopFailure`
Runs when a response fails.

- Plays failure sound
- Sends error notification

---

#### `PermissionRequest`
Runs when Claude asks for approval.

- Notifies with context (command / reason if available)

These hooks (`Stop`, `StopFailure`, `PermissionRequest`) provide desktop notifications and optional sounds.

- **Sounds are configurable** via `sounds_directory` in `config.json`
- Each event can use a different sound
- Notifications can be suppressed when a dev app (editor/terminal) is already focused


> Cursor already provides built-in editor notifications, so this package does **not** duplicate that behavior there.

---

## Configuration

### Files

| File | Purpose |
|------|--------|
| `config.json` | Enables logging, controls storage, sounds |
| `settings.json` | Maps Claude events → hook scripts |

---

### Sounds

- Set `sounds_directory` to your preferred audio files
- Each notify hook maps to a sound (success / failure / permission)
- If not configured, default sounds are used or playback is skipped

### Session tracking options that can be changed in config

| Key | Meaning |
|-----|--------|
| `enabled` | Enables/disables logging |
| `store_directory` | Where logs are stored (default `work-logs/`) |
| `stale_session_days` | Auto-close inactive sessions |
| `temp_session_id_log` | Optional debug logging for session IDs (see config comments if present) |

---

## Logging model

- Logs are written to `work-logs/` (configurable)
- One JSON file per day
- One entry per `session_id`

Each session includes:
- timestamps (`started_at`, `ended_at`)
- duration
- project + branch
- **`session_logs`**: array of `{ captured_at, user_intent, prompt_summary, provided_context, what_i_did, open_issues, next_best_step }` (fields present when parsed)
- optional `resume_events`

Older files may still show legacy `summary_bullets`; new sessions use `session_logs` only.

---

## Example

```json
{
  "sessions": [
    {
      "session_id": "abc123",
      "tool": "claude",
      "model": "claude-sonnet-4-6",
      "started_at": "...",
      "ended_at": "...",
      "duration_minutes": 30,
      "session_logs": [
        {
          "captured_at": "2026-04-19T12:00:00.000Z",
          "user_intent": "Fix the login bug.",
          "prompt_summary": "Reproduce and patch auth flow.",
          "provided_context": "Error logs pasted.",
          "what_i_did": "Updated validateSession().",
          "open_issues": "None.",
          "next_best_step": "Add an integration test."
        }
      ],
      "resume_events": []
    }
  ]
}
```
