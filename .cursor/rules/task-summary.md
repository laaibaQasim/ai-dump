# Task summary (session logging)

## When this rule applies

**Only when** **`session_tracking.enabled`** is **`true`** in **`.cursor/config.json`** (and for the same behavior in Claude Code, **`.claude/config.json`**). Session hooks use the `**Summary:**` block to fill work logs.

If **`session_tracking.enabled`** is **`false`** or unset, **do not** require the structured `**Summary:**` / Implementation Details format for this project—answer in a normal, concise way unless the user asks for a summary.

If unsure, read `.cursor/config.json` (and `.claude/config.json` when using Claude Code) before applying the rules below. If the project-level config does not exist, fall back to `~/.cursor/config.json` (and `~/.claude/config.json` for Claude Code) at the system level.

---

## Requirements (only when session tracking is enabled)

When **`session_tracking.enabled`** is **`true`**, and you are responding to task-based requests (coding, debugging, feature implementation, etc.):

1. **Always include summaries for coding tasks** — no exceptions, regardless of response length
2. **Skip summaries only for**: non-coding task responses (research, questions, explanations) that are 2-3 lines or less
3. **Format**: "You asked me to [X], here's a summary of what I did: [summary]"
4. **For coding tasks**: Add "Implementation Details" or "Final Look" section before summary with:
   - Key files changed (with line numbers where relevant)
   - Important changes or decisions made
5. **Summary length**: One paragraph maximum, concise
6. **Heading format** (REQUIRED for hook detection when logging is on): Always use `**Summary:**` as the exact heading — do not use alternatives like "## Summary" or "Summary:"

**Purpose** (when enabled): End-of-day logging of chat responses for work tracking and auditing.

### Example Format (Coding Task)
```
[... response content ...]

**Implementation Details:**
- Updated `src/components/Button.tsx:45-60` to add loading state
- Modified `utils/validate.ts` to fix input sanitization

**Summary:**
You asked me to add a loading state to the Button component. I updated the component to accept a `loading` prop that disables the button and shows a spinner, then fixed a related validation issue in the utils file that was preventing proper error handling.
```

### Example Format (Non-Coding Task)
```
[... response content ...]

**Summary:**
You asked me to investigate the build failures. I found that the TypeScript config was missing the `skipLibCheck` flag and updated it, which resolved 3 of the 5 failing type checks.
```

---

## Interaction Logging Rule

**When this applies:** Only when **`session_tracking.enabled`** is **`true`** in **`.cursor/config.json`** (or **`.claude/config.json`** when using Claude Code).

For every user request, append a very short structured summary at the end of your response under the heading:

### Session Log

This section must always be included unless the user explicitly asks you not to include it.

The Session Log must contain these fields:

- **User Intent:** A 1-2 sentence summary of what the user asked for.
- **Prompt Summary:** A very short compressed summary of the user's prompt, including only the essential task, constraints, and expected outcome.
- **Provided Context:** A short summary of any files, code, logs, screenshots, or pasted content the user supplied. Do not repeat large blocks verbatim. Summarize only what is relevant.
- **What I Did:** A short summary of the work completed in this response.
- **Open Issues:** Any missing information, uncertainty, limitations, or unresolved problems.
- **Next Best Step:** The most useful immediate next action for the user or agent.

Rules for compression:
- Never repeat the full user prompt unless explicitly requested.
- Never dump full code or file contents into the Session Log.
- If the user provides code, summarize it by purpose, affected components, and relevant issue only.
- If the user provides multiple files, summarize them collectively in one short line unless file-level detail is necessary.
- Keep the entire Session Log concise and low-noise.
- Prefer signal over detail.
- Use plain English.
- Avoid filler words.

### Example Format

```
[... response content ...]

### Session Log
- **User Intent:** Add a loading state to the Button component.
- **Prompt Summary:** Update Button to show spinner and disable while loading; fix related validation bug.
- **Provided Context:** Button.tsx and validate.ts snippets provided.
- **What I Did:** Added `loading` prop to Button, updated validate.ts to handle error edge case.
- **Open Issues:** No tests updated yet.
- **Next Best Step:** Add unit tests for the new loading state behavior.
```
