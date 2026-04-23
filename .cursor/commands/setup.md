Setup this project.
---
description: >-
  Initialize ai-dump: create work-logs, copy example configs,
  update .git/info/exclude, run hook tests.
  Supports project-level and system-level (~/.claude / ~/.cursor) installation.
---

# Setup

One-time local setup for Claude/Cursor hooks in this repo.

**Before doing anything else, ask the user:**

> "Do you want to install hooks at the **project level** (everything stays in this repo — only affects this project) or at the **system level** (hooks live in `~/.claude/` and `~/.cursor/` and apply to every project on this machine)?"

Wait for their answer, then follow the matching option below.

---

## Option A — Project-level setup

Set up this repository for local Claude/Cursor hook usage.

Follow this exact flow:

1. First, inspect the repo and confirm these paths:
   - `.claude/config.json.example`
   - `.cursor/config.json.example`
   - `.claude/hooks/__tests__`
   - `.cursor/hooks/__tests__` (optional)
   - `.git/` (optional, only if this is a git repo)

2. Do the setup work:
   - Create `work-logs/` in the repository root if it does not already exist.
   - If `.claude/config.json` does not exist and `.claude/config.json.example` exists, copy the example file to `.claude/config.json`.
   - If `.cursor/config.json` does not exist and `.cursor/config.json.example` exists, copy the example file to `.cursor/config.json`.
   - Never overwrite an existing `config.json` without asking.
   - If this repo has a `.git/` directory:
     - Ensure `.git/info/` exists.
     - Ensure `.git/info/exclude` contains these exact lines, adding only missing ones:
       - `work-logs/`
       - `.claude/config.json`
       - `.cursor/config.json`

3. Run tests:
   - If `.claude/hooks/__tests__` exists, run:
     `node --test .claude/hooks/__tests__`
   - If `.cursor/hooks/__tests__` exists, also run:
     `node --test .cursor/hooks/__tests__`
   - If Node is missing, stop and explain that Node is required.

4. When finished, give a concise summary that includes:
   - Whether config files were created
   - Whether `work-logs/` was created
   - Whether `.git/info/exclude` was updated
   - Whether tests passed

5. End with these smoke-test instructions:
   - Run one short task in Claude Code
   - Run one short task in Cursor
   - Trigger a permission request once
   - Confirm logs appear under `work-logs/`
   - Confirm Claude notifications behave as expected

Rules for Option A:
- Do not use npm.
- Do not install dependencies.
- Do not use sudo.
- Do not touch files outside this repository, except `.git/info/exclude` inside this repository.
- Prefer exact, minimal edits.
- If a required example config file is missing, report it clearly.
- If this is not a git repo, skip exclude-file setup and say so.

---

## Option B — System-level setup

Copies hooks to `~/.claude/hooks/` and `~/.cursor/hooks/` so they work across every project on this machine. Work-logs stay in each project's root (written by the hooks at runtime using the current working directory).

Follow this exact flow:

### 1. Verify prerequisites

- Check that `node` is on the PATH. If not, stop and tell the user Node.js is required.
- Confirm these source files exist in the repo: `.claude/hooks/session-start.js`, `.claude/hooks/session-end.js`, `.claude/hooks/notify-stop.js`, `.claude/hooks/notify-failure.js`, `.claude/hooks/notify-permission.js`. Report any that are missing and stop if any are absent.

### 2. Copy Claude hooks to `~/.claude/hooks/`

- Create `~/.claude/hooks/` if it does not exist.
- Copy every `.js` file from `.claude/hooks/` (excluding the `__tests__` subdirectory) to `~/.claude/hooks/`, overwriting existing files.

### 3. Write `~/.claude/settings.json`

- If `~/.claude/settings.json` does not exist, create it with exactly this content:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/session-start.js\""
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/session-end.js\"",
            "timeout": 30
          }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/notify-stop.js\""
          }
        ]
      }
    ],
    "StopFailure": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/notify-failure.js\""
          }
        ]
      }
    ],
    "PermissionRequest": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"$HOME/.claude/hooks/notify-permission.js\""
          }
        ]
      }
    ]
  }
}
```

- If `~/.claude/settings.json` already exists and already has a `hooks` key, **do not overwrite it**. Instead, read the file and check whether each of the five hook entries above is already present. Add only the missing entries under their respective event keys, preserving any existing content.

### 4. Copy `~/.claude/config.json`

- If `.claude/config.json.example` exists in the repo and `~/.claude/config.json` does not exist, copy the example file to `~/.claude/config.json`.
- If `~/.claude/config.json` already exists, leave it unchanged.

### 5. Copy Cursor hooks to `~/.cursor/hooks/`

- Create `~/.cursor/hooks/` if it does not exist.
- Copy every `.js` file from `.cursor/hooks/` to `~/.cursor/hooks/`, overwriting existing files.

### 6. Write `~/.cursor/hooks.json`

- If `~/.cursor/hooks.json` does not exist, create it with exactly this content:

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [{ "command": "$HOME/.cursor/hooks/session-start.js" }],
    "afterAgentResponse": [{ "command": "$HOME/.cursor/hooks/capture-summary.js" }],
    "sessionEnd": [{ "command": "$HOME/.cursor/hooks/session-end.js", "timeout": 30 }]
  }
}
```

- If `~/.cursor/hooks.json` already exists and already has a `hooks` key, **do not overwrite it**. Read the file and add only the missing entries under their respective event keys, preserving any existing content.
- If `.cursor/config.json.example` exists and `~/.cursor/config.json` does not, copy the example to `~/.cursor/config.json`.

### 7. Create `work-logs/` in the project root

- Create `work-logs/` in this repository root if it does not already exist.
- If this is a git repo, ensure `.git/info/exclude` contains `work-logs/` (adding it if missing).
- Do NOT add `.claude/config.json` or `.cursor/config.json` to the project exclude — those are now system-level files.

### 8. Disable project-level Claude hook wiring

If `.claude/settings.json` exists in this repo and contains a `hooks` key (the project-level wiring), **warn the user** that leaving it in place will cause every hook to fire twice (once from the project settings, once from the system settings). Ask whether they want to remove the `hooks` key from `.claude/settings.json` or delete the file entirely. Act on their answer.

### 9. Run tests

- If `.claude/hooks/__tests__` exists, run: `node --test .claude/hooks/__tests__`
- Report pass or failure.

### 10. Summary

Give a concise summary that includes:
- Which hook files were copied to `~/.claude/hooks/` and `~/.cursor/hooks/`
- Whether `~/.claude/settings.json` was created or merged
- Whether `~/.claude/config.json` was created or skipped
- Whether `~/.cursor/hooks.json` was created or merged
- Whether `~/.cursor/config.json` was created or skipped
- Whether `work-logs/` was created
- Whether tests passed
- Any duplicate-hooks warning issued

End with this note:

> Both `~/.claude/settings.json` and `~/.cursor/hooks.json` apply globally — no per-project hook wiring needed. For each new project, just create `work-logs/` and you're done.

Rules for Option B:
- Do not use sudo.
- Do not overwrite `~/.claude/settings.json` wholesale if it has existing content — merge carefully.
- Do not overwrite `~/.claude/config.json` if it already exists.
- Only touch files inside this repository and inside `~/.claude/` and `~/.cursor/`.
- If Node is missing, stop immediately.
