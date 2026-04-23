# productivity-kit

**productivity-kit** wires **Claude Code** and **Cursor** into your day: you get alerted when something needs you or finishes, and you keep structured session logs for standups, time review, and debugging.

- **Sound** (bundled MP3s) and **desktop notifications** when runs stop, fail, or need permission
- **Session logs** captured from assistant replies into daily JSON under `work-logs/`
- Small **Node** scripts only (no extra packages); copy into a project or use from `~/.claude/`

---

## Table of Contents

- [How It Works](#how-it-works)
- [What This Solves](#what-this-solves)
- [Hooks](#hooks)
- [Session Logging](#session-logging)
- [Commands](#commands)
- [Quick Start](#quick-start)
- [Log Analysis](#log-analysis)
- [Detailed Docs](#detailed-docs)
- [Vision](#vision)
- [Contributing](#contributing)
- [License](#license)

---

## How It Works

## Quick Start

1. **Copy** this repo into your project, or copy **`.claude/`** into your user-level config (`~/.claude/`).
2. **Install Node.js** and ensure `node` is on your `PATH` (hooks use Node built-ins only).
3. In **Cursor**, run the project custom command **setup** (`.cursor/commands/setup.md`) from the commands menu or chat.
4. Run a **short test task** in Cursor and Claude Code; optionally trigger a **permission** flow to hear/see the approval hook.

<details>
<summary>Setup details</summary>

- **setup** creates `work-logs/`, copies example configs when missing, optionally updates `.git/info/exclude`, runs hook tests, and asks whether local configs and logs should be tracked in git.
- Session logging is toggled with **`session_tracking.enabled`** in [`.claude/config.json`](.claude/config.json) and [`.cursor/config.json`](.cursor/config.json) (defaults write under `work-logs/`).

**Keep local files out of Git (manual alternative)**

If you skip **setup** or need extra paths, append to `.git/info/exclude`:
```
work-logs/
.claude/config.json
.cursor/config.json
```
These are machine-local ignores and don't touch the shared `.gitignore`.

**Smoke-test the hooks**

Ask the agent to do something that requires approval (e.g. create a file in a path the tool must confirm) to exercise the permission hook.

**Filesystem scope:** hooks **write** only under the project root (default `work-logs/`, with path safeguards) and **read** only transcript paths supplied by Claude Code or Cursor.

</details>

---

## How It Works

1. **Hooks** listen to Claude Code / Cursor lifecycle events (session start/end, stop, failure, permission, after-agent reply).
2. **Scripts** under [`.claude/hooks/`](.claude/hooks/) and [`.cursor/hooks/`](.cursor/hooks/) play sounds / show notifications or parse replies and update the store.
3. **Logs** are written as one file per day — `work-logs/session-work-log-YYYY-MM-DD.json` — when session tracking is enabled.
4. **You** skim or query those files (and transcripts) to improve prompts, estimate time, and see what actually shipped.
5. It runs out of the box with the bundled hook wiring ([`.claude/settings.json`](.claude/settings.json), [`.cursor/hooks.json`](.cursor/hooks.json)).

---

## What This Solves

| Problem | How the kit helps |
|---------|-------------------|
| Missing important events | Finish, failure, and approval prompts surface without watching the terminal |
| Babysitting long runs | Step away; get alerted when something matters |
| Slow failure diagnosis | Logs and transcripts help pinpoint errors and delays |
| Prompt quality drift | Review what the model did vs. what you asked for |
| Lost work context | Daily files preserve context after sessions end |

---

## Hooks

---

## Hooks

| Tool | Events | Role |
|------|--------|------|
| **Claude Code** | `SessionStart`, `SessionEnd` | Daily JSON session logs |
| **Claude Code** | `Stop`, `StopFailure`, `PermissionRequest` | Desktop notifications on completion, failure, or approval needed |
| **Cursor** | `sessionStart`, `sessionEnd` | Same session log model as Claude Code (finalize + transcript fallback) |
| **Cursor** | `afterAgentResponse` | Appends a timestamped entry to `session_logs` while the session is open |

Wiring is in [`.claude/settings.json`](.claude/settings.json) and [`.cursor/hooks.json`](.cursor/hooks.json).

---

## Session Logging

When session tracking is enabled, each session row stores **`session_logs`**: an array of objects, one per captured reply, each containing:

`captured_at` | `user_intent` | `prompt_summary` | `provided_context` | `what_i_did` | `open_issues` | `next_best_step`

See project rules in `CLAUDE.md` / `.cursor/rules/task-summary.md` for full field definitions.

<details>
<summary><strong>Example session log entry</strong></summary>

```json
{
  "captured_at": "2026-04-19T12:34:56.789Z",
  "user_intent": "Ship the README refresh.",
  "prompt_summary": "Restructure intro, add How it works, tighten Quick start.",
  "provided_context": "README.md and prior feedback bullets.",
  "what_i_did": "Rewrote sections and added an example JSON block.",
  "open_issues": "None.",
  "next_best_step": "Optional: add a real screenshot path under docs/."
}
```

</details>

---

## Commands

---

## Commands

| Command | File | What it does |
|---------|------|-------------|
| **setup** | [`setup.md`](.cursor/commands/setup.md) | One-time setup: creates `work-logs/`, copies example configs, updates `.git/info/exclude`, runs hook tests |
| **/logger** | [`logger.md`](.cursor/commands/logger.md) | Reads your session log for a given date, groups entries into major tasks with time estimates, outputs a standup-ready summary |

<details>
<summary><strong>/logger — daily work summary</strong></summary>

Run **/logger** in Cursor chat at any point during or at the end of your day. It will:

- Parse the daily `session-work-log-YYYY-MM-DD.json` for a date you choose (defaults to today)
- Cluster related log entries into major tasks, ignoring noise and trivial retries
- Estimate time per task using `captured_at` timestamps, deduplicating overlapping Claude + Cursor sessions
- Output a clean summary:

```
## Daily Log — 2026-04-19

**Total active time:** 8h 9m

### Major Tasks
1. **Session hook refactoring** — ~50 min
   Summary: Simplified session lookup and centralized shared utilities...

### Other minor work
- Re-read rules file to confirm session tracking was enabled
```

</details>

</details>

---

## Quick Start

1. **Copy** this repo into your project, or copy **`.claude/`** into your user-level config (`~/.claude/`).
2. **Install Node.js** and ensure **`node`** is on your `PATH` (hooks use Node built-ins only).
3. In **Cursor**, run the project custom command **setup** ([`.cursor/commands/setup.md`](.cursor/commands/setup.md)) from the commands menu or chat.
4. Run a **short test task** in Cursor and Claude Code; optionally trigger a **permission** flow to hear/see the approval hook.

<details>
<summary><strong>Setup details</strong></summary>

- **setup** creates `work-logs/`, copies example configs when missing, optionally updates `.git/info/exclude`, runs hook tests, and asks whether local configs and logs should be tracked in git.
- Session logging is toggled with **`session_tracking.enabled`** in [`.claude/config.json`](.claude/config.json) and [`.cursor/config.json`](.cursor/config.json) (defaults write under `work-logs/`).

</details>

<details>
<summary><strong>Keep local files out of Git (manual)</strong></summary>

If you skip **setup** or need extra paths, append to `.git/info/exclude`:

```
work-logs/
.claude/config.json
.cursor/config.json
```

These are machine-local ignores — no shared `.gitignore` needed.

</details>

<details>
<summary><strong>Smoke-test the hooks</strong></summary>

</details>

---

</details>

---

## Log Analysis

The [`log-analysis/`](log-analysis/) directory contains a Python pipeline that runs your session logs through four LLM analysis passes (prompt audit, cost optimization, skills clustering, rules extraction) using the Gemini API, then synthesizes the results into a single prioritized report.

See the [log-analysis README](log-analysis/README.md) for setup and usage.

---

## Detailed Docs

| Doc | Contents |
|-----|----------|
| [Claude hooks](docs/claude-hooks.md) | Config, each hook, edge cases, filesystem scope |
| [Cursor hooks](docs/cursor-hooks.md) | Config, each hook, edge cases, filesystem scope |
| [log-analysis/README.md](log-analysis/README.md) | Full analysis setup and command reference |

---

## Vision

Longer term, this kit is meant to help you spot inefficiencies, tighten prompts, and move toward more agentic workflows — while building intuition for which models and patterns save time and cost.

---

## Contributing

Contributions are welcome! To get started:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a Pull Request

---

## License

See [LICENSE](LICENSE).
