# Workaholic

Workaholic is a local terminal task manager with a built-in Pomodoro timer. It lets you organize work in a flexible tree of directories, projects, tasks, and subtasks without requiring an account or a server.

## Features

- Canonical `DIR → PRJ → TASK` organization with nested directories and subtasks.
- Loose tasks at the root, directory, project, or task level.
- Automatic `DIR`, `PRJ`, then `TASK` ordering at every level.
- Clear tree connectors, collapsible branches, and explicit item labels.
- Task completion, multiline task details, moving, renaming, and reordering.
- A visible `[FOCUS]` marker on the task attached to the active Pomodoro.
- A hot coffee drawing while a Pomodoro is active.
- Configurable focus and break durations from inside the app.
- Pause, resume, cancel, and automatic completion of Pomodoro sessions.
- Desktop notification and terminal bell when a timer finishes.
- Trash with subtree restore and permanent deletion.
- One local SQLite file at `~/.workaholic.db` by default.
- Timer recovery after closing and reopening the app.

## Try it from source

You need [Bun](https://bun.sh/) and [pnpm](https://pnpm.io/) installed.

```bash
git clone https://github.com/Luisgarcav/workaholic.git
cd workaholic
pnpm install
pnpm start
```

To keep the data in another location:

```bash
pnpm start -- --data-file ./workaholic.db
```

## Build a standalone binary

Linux x64:

```bash
pnpm build:linux
./dist/workaholic-linux-x64
```

macOS x64 and Apple Silicon:

```bash
pnpm build:macos
./dist/workaholic-macos-arm64
```

Use `./dist/workaholic-macos-x64` on an Intel Mac. The resulting binary does not require Bun, pnpm, or Node.js on the machine where it runs.

## Keyboard controls

| Key | Action |
| --- | --- |
| `↑` / `↓` or `j` / `k` | Navigate |
| `←` / `→` or `h` / `l` | Collapse or expand a branch |
| `Space` | Complete or reopen a task |
| `a` / `A` | Add the next item at the current level or at root |
| `c` | Create a child; on a task, create a subtask |
| `r` | Rename the selected item |
| `e` | Edit task details; save with `Ctrl+S` |
| `m` | Move the selected item |
| `J` / `K` | Reorder down or up |
| `d` | Move to Trash |
| `t` | Switch between Work and Trash |
| `u` | Restore the selected Trash item |
| `p` | Start, pause, or resume a focus Pomodoro |
| `b` | Start a break |
| `x` | Cancel the active Pomodoro |
| `s` | Configure focus and break durations |
| `?` | Open help |
| `q` or `Ctrl+C` | Quit |

## Organization rules

- Root: directories or loose tasks.
- Directory: nested directories, projects, or loose tasks.
- Project: tasks.
- Task: subtasks.

When creating an item, Workaholic chooses the natural next type. Use `Tab`, `←`, or `→` in the creation dialog to switch between the types allowed at that location.

## Development

```bash
pnpm test
pnpm typecheck
pnpm dev
```

The app uses TypeScript, Solid, [OpenTUI](https://opentui.com/), Bun, and SQLite. Its timer experience was inspired by [bashbunni's terminal Pomodoro gist](https://gist.github.com/bashbunni/3880e4194e3f800c4c494de286ebc1d7).

## Disclaimer

This is a learning project created to explore OpenTUI and understand how terminal user interfaces work. It is not intended to be production-grade task management software.
