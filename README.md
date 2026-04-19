# ai-dump

## Track your AI workflows smarter

This project sends real-time voice notifications when your tasks need attention or finish—so you don’t have to keep checking your screen. It also summarizes your sessions to help you write daily standups, track time, and review what actually happened.

The bigger goal: help you spot inefficiencies, improve prompts, and move toward agentic workflows—while understanding which models work best so you save both time and cost.

## What this repo is

A plug-and-play toolkit for **Claude Code** and **Cursor** that adds notifications and session logging to your workflow.

- Get notified when tasks finish, fail, or need input  
- Track what happens in every session with structured logs (`session_logs`)  
- Review past runs to debug issues and improve prompts  

Works out of the box with simple Node scripts. See [`docs/`](docs/) for full behavior.

## What this solves

- **Don’t miss important events** — Get notified when tasks finish, fail, or need your input  
- **Avoid babysitting long runs** — Step away and get alerted when something matters  
- **Understand failures faster** — Use logs to spot errors, delays, or weak spots  
- **Improve prompts over time** — Review past sessions to see what worked  
- **Keep a history of work** — Retain context after sessions end  
- **Make better decisions** — Use real usage data instead of guesswork  

## Hooks in this repo

| Tool | Events | Role |
|------|--------|------|
| **Claude Code** | `SessionStart`, `SessionEnd` | Daily JSON session logs. On end, scans the transcript for `### Session Log` blocks and writes `session_logs`. Works with project rules that ask for a `### Session Log` (and optional `**Summary:**`) on coding tasks. |
| **Claude Code** | `Stop`, `StopFailure`, `PermissionRequest` | Desktop notifications when a run completes, fails, or needs approval. |
| **Cursor** | `sessionStart`, `sessionEnd` | Same session log model as Claude Code (finalize + transcript fallback). |
| **Cursor** | `afterAgentResponse` | Runs `capture-summary.js`: parses each assistant reply for `### Session Log` and **appends** a timestamped entry to `session_logs` while the session is open. |

Scripts live under [`.claude/hooks/`](.claude/hooks/) and [`.cursor/hooks/`](.cursor/hooks/). Wiring is in [`.claude/settings.json`](.claude/settings.json) and [`.cursor/hooks.json`](.cursor/hooks.json).

### What gets logged

When session tracking is enabled, each session row stores **`session_logs`**: an array of objects, one per captured reply, each with:

- **`captured_at`** — ISO timestamp when the entry was written  
- **`user_intent`**, **`prompt_summary`**, **`provided_context`**, **`what_i_did`**, **`open_issues`**, **`next_best_step`** (see project rules in `CLAUDE.md` / `.cursor/rules/task-summary.md`)

Older daily files may still contain legacy `summary_bullets`; new sessions use `session_logs` only.

## Quick start

Copy this repo into your project, or copy `.claude/` into your user-level config (**`~/.claude/`**). Ensure **Node** is on your `PATH` (hooks use Node built-ins only).

### Run the **setup** command

In Cursor, run the project custom command **setup** ([`.cursor/commands/setup.md`](.cursor/commands/setup.md))—for example from the commands menu or by referencing it in chat the way you usually invoke project commands.

The agent creates `work-logs/`, copies example configs when missing, optionally updates **`.git/info/exclude`**, runs hook tests—but only after you answer whether local configs and logs should be tracked by git, so edits stay explicit and reviewable.

Session logging is toggled with **`session_tracking.enabled`** in [`.claude/config.json`](.claude/config.json) and [`.cursor/config.json`](.cursor/config.json) (defaults write under `work-logs/`). Full options are in the [detailed docs](#detailed-docs) below.

### Keep local files out of Git (manual alternative)

If you skip **setup** or need extra paths, use **`.git/info/exclude`** so ignores stay on your machine only (no shared `.gitignore`). Append `work-logs/`, `.claude/config.json`, and `.cursor/config.json` as needed—the same entries the **setup** command adds when you choose not to track those files.

### Smoke-test the hooks

Run a short task in **Cursor** and **Claude Code**. To exercise the permission hook, ask the agent to do something that triggers an approval (for example, create a small file in a safe path the tool must confirm).

Hooks do not access arbitrary paths.

- **Write**: only under the project root (default `work-logs/`, with safeguards preventing path escape)  
- **Read**: only from transcript paths provided by Claude Code or Cursor  

Treat hook stdin as trusted only to the extent you trust those tools.

## Detailed docs

| Doc | Contents |
|-----|----------|
| [Claude hooks](docs/claude-hooks.md) | Config, each hook, edge cases, filesystem scope |
| [Cursor hooks](docs/cursor-hooks.md) | Config, each hook, edge cases, filesystem scope |

## License

See [LICENSE](LICENSE).

Analysis features are still evolving, so feedback and ideas are welcome. If this is useful, consider starring the repo to follow updates.
