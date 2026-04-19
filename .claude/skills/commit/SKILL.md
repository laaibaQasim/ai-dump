---
name: commit
description: Scans staged and unstaged changes for sensitive data, then writes a concise commit message and commits locally. Use when the user wants to commit current work safely.
allowed-tools: Shell, Read, Grep
effort: medium
---

# Commit

Safely commit the current working changes with a concise, descriptive message.

## Step 1 — Gather the diff

```bash
git status --short
git diff HEAD
```

If there are no changes (`git status` reports nothing), stop and tell the user "Nothing to commit — working tree is clean."

## Step 2 — Scan for sensitive data

Before doing anything else, scan the full diff for the patterns below. If ANY match is found, **stop immediately**, show the user the exact file and line, and do NOT commit.

Patterns to reject:

| Category | Examples to detect |
|---|---|
| .env file staged | `diff --git a/.env` or `diff --git a/.env.` |
| API keys | tokens matching `sk-[A-Za-z0-9]{20,}`, `AIza[0-9A-Za-z\-_]{35}`, `AKIA[0-9A-Z]{16}` |
| GitHub PATs | `ghp_[A-Za-z0-9]{36}`, `github_pat_` |
| Generic secrets | variable names containing `SECRET`, `PASSWORD`, `PASSWD`, `TOKEN`, `PRIVATE_KEY` assigned to a string literal |
| Private keys | `-----BEGIN (RSA|EC|OPENSSH|PGP) PRIVATE KEY` |
| Patch files staged | any file ending in `.patch` |

Use `Grep` on the diff output for each pattern. If clean, proceed.

## Step 3 — Stage changes

If nothing is staged yet (`git diff --cached` is empty), stage all tracked changes:

```bash
git add -u
```

Do **not** `git add .` — do not stage untracked files the user has not explicitly added. If the user wants to stage specific files, ask them which ones before staging.

## Step 4 — Write the commit message

Analyse the staged diff and write a commit message that:

- Summarises the **what** and **why** in ≤ 72 characters on the first line.
- Uses imperative mood ("Add", "Fix", "Remove", "Update" — not "Added", "Adds").
- Optionally includes a blank line followed by a short body (2–4 bullet points) for complex changes — skip the body for small/obvious commits.
- Does **not** mention file names unless they are the entire point of the change.
- Does **not** start with "Commit", "Update files", or other filler phrases.

## Step 5 — Commit

```bash
git commit -m "$(cat <<'EOF'
<first line — ≤72 chars>

- <optional bullet 1>
- <optional bullet 2>
EOF
)"
```

Show the user:
- The commit message used.
- The output of `git log --oneline -1` to confirm success.

## Hard rules

- **Never push.** Commit locally only.
- **Never use `git add .`** unless the user explicitly asks for it.
- **Abort on any sensitive match** — do not try to redact and retry.
- **One commit per invocation.** If the user mentions multiple logical changes, suggest splitting into separate commits and ask which to do first.
- Never use `--no-verify`.
