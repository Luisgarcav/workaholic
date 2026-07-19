import { homedir } from "node:os"
import { resolve } from "node:path"

export type CliResult =
  | { action: "run"; dataFile: string }
  | { action: "help" }
  | { action: "version" }

export function parseCli(args: string[]): CliResult {
  let dataFile = resolve(homedir(), ".workaholic.db")

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === "--help" || arg === "-h") return { action: "help" }
    if (arg === "--version" || arg === "-v") return { action: "version" }

    if (arg === "--data-file") {
      const value = args[index + 1]
      if (!value) throw new Error("--data-file requires a path")
      dataFile = resolve(expandHome(value))
      index += 1
      continue
    }

    if (arg.startsWith("--data-file=")) {
      const value = arg.slice("--data-file=".length)
      if (!value) throw new Error("--data-file requires a path")
      dataFile = resolve(expandHome(value))
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return { action: "run", dataFile }
}

function expandHome(path: string): string {
  if (path === "~") return homedir()
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2))
  return path
}

export const HELP_TEXT = `workaholic — tasks and Pomodoro in your terminal

Usage:
  workaholic [options]

Options:
  --data-file <path>  Use another SQLite database (default: ~/.workaholic.db)
  -h, --help          Show this help
  -v, --version       Show the version
`
