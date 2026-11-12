# Waitlight for Claude Code

> **Work in progress.** Early version: feedback and bug reports are very welcome.

Waitlight shows at a glance which of your Claude Code chat sessions is working, done, or waiting for you, right inside VS Code, Cursor, and other VS Code–based editors. See what you asked in each session without scrolling. Open source, fully local, and unofficial: not affiliated with Anthropic.

<!-- TODO: screenshot of the Claude Sessions list and the status bar -->

## What you get

- **A "Claude Sessions" list in the Explorer.** One row per open chat, with its title and how long it has been in its current state.

  | Icon | State | Meaning |
  |---|---|---|
  | 🔔 blue | **Needs you** | Claude is waiting for a permission or an answer |
  | spinner, gold | **Running** | Claude is working |
  | ✓ green | **Done** | Finished; waiting for your next prompt |
  | ○ grey | **Idle** | Nothing happening for a while |

- **Why it's waiting.** Hover a session to see, for example, "Permission to run: npm test" or "Claude asked: Which database?".
- **What you asked.** Expand a session to see every prompt you sent, newest first. Hover one for the full text, when you sent it, and previews of any images you attached. Right-click to copy a prompt.
- **Jump to a chat.** Click the ↗ button on a row to open or focus that Claude Code tab.
- **Next session that needs you.** Press <kbd>Cmd</kbd>+<kbd>Alt</kbd>+<kbd>W</kbd> (macOS) or <kbd>Ctrl</kbd>+<kbd>Alt</kbd>+<kbd>W</kbd> (Windows/Linux) to jump to the chat that has waited longest. Press again for the next one.
- **Status bar.** A quiet session count that turns blue with a bell when something needs you. Hover it for a summary.

## Setup

1. Install Waitlight. Your open Claude Code chats appear in **Explorer → Claude Sessions** straight away, showing Running and Done.
2. To also see **Needs you**, run **Waitlight: Set Up Session Tracking** (or use the button in the Claude Sessions list). Waitlight asks first, then:
   - backs up `~/.claude/settings.json`,
   - adds a few [Claude Code hooks](https://code.claude.com/docs/en/hooks), keeping all your existing settings and hooks,
   - copies a small script to `~/.claude/waitlight/`.
3. Start a new chat. (Chats that were already open may need a restart to pick up the hooks.)

**Requirements:** Claude Code (VS Code extension or CLI) and [Node.js](https://nodejs.org) for the hook script.

If something doesn't look right, run **Waitlight: Check Setup**. It shows what's installed and when the last event arrived.

## Privacy

Everything stays on your computer. Waitlight makes **no network requests** and collects **no telemetry**.

It only reads files Claude Code already keeps on your machine (your open chats and chat logs in `~/.claude/`) and the small status files its own hook script writes there.

## Removing Waitlight

- **Waitlight: Remove Session Tracking** removes only Waitlight's hook entries (after a backup). Your other settings and hooks are untouched.
- **Uninstalling the extension** does the same automatically, and deletes `~/.claude/waitlight/`, unless Waitlight is still installed in another editor that uses the hooks.

## Settings

| Setting | Default | What it does |
|---|---|---|
| `waitlight.show` | `all` | Show sessions from all folders, or only this window's (also the filter button in the list) |
| `waitlight.idleAfterMinutes` | `30` | A Done session turns grey (Idle) after this many quiet minutes |
| `waitlight.maxTitleLength` | `24` | Longest title shown before it's shortened, so the time stays visible |

## Known limitations

- Claude Code reports "needs you" through hooks only, so that state needs the one-time setup.
- After you approve a permission, a session can stay blue until the approved tool finishes.
- The list of open chats and the chat logs are internal Claude Code files. A Claude Code update could change them; Waitlight then falls back to the hooks.
- Jumping to a chat works for chats that belong to the folder open in the current window.

## Contributing

Issues and pull requests are welcome at [github.com/monis01/Waitlight](https://github.com/monis01/Waitlight).

```sh
npm install
npm test          # unit tests
npm run fake:live # fake sessions for UI work; then F5 → "Run Waitlight (fake sessions)"
```

## License

[MIT](LICENSE). Waitlight is an independent, unofficial project and is not affiliated with or endorsed by Anthropic. "Claude" and "Claude Code" are trademarks of Anthropic.
