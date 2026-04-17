# ai-dump

Claude hooks that play sounds and send macOS notifications for key agent events.

## Hooks

Three hooks fire automatically during Claude sessions:

| Event | Hook file | Default sound |
|---|---|---|
| Task completed | `notify-stop.js` | `task-completed.mp3` |
| Task failed | `notify-failure.js` | `task-failed.mp3` |
| Permission needed | `notify-permission.js` | `approval-required.mp3` |

Notifications are suppressed when Cursor, Terminal, VS Code, iTerm2, or Warp is the frontmost app — they only fire when you're away.

---

<details>
<summary>How do I disable all hooks?</summary>

Set `enabled` to `false` in `.claude/config.json`:

```json
{ "enabled": false }
```

</details>

<details>
<summary>How do I enable or disable a specific hook?</summary>

Toggle the `enabled` field on any hook in `.claude/config.json`:

```json
{
  "hooks": {
    "task_done":        { "enabled": false },
    "task_failed":      { "enabled": true  },
    "permission_needed":{ "enabled": true  }
  }
}
```

</details>

<details>
<summary>How do I change a sound?</summary>

Update the `sound` field for the relevant hook and drop your `.mp3` into the sounds directory:

```json
{
  "hooks": {
    "task_done": { "enabled": true, "sound": "my-custom-sound.mp3" }
  }
}
```

</details>

<details>
<summary>How do I change the sounds directory?</summary>

Update `sounds_directory` in `.claude/config.json` to any absolute or relative path:

```json
{ "sounds_directory": "/Users/you/sounds" }
```

</details>

---

> macOS only — notifications use `osascript` and audio uses `afplay`.
