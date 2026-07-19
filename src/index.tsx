import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { render } from "@opentui/solid"
import packageJson from "../package.json"
import { HELP_TEXT, parseCli } from "./cli.ts"
import { WorkaholicDatabase } from "./data/database.ts"
import { WorkaholicApp } from "./ui/app.tsx"

let cli
try {
  cli = parseCli(process.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  console.error("Use --help to see the available options.")
  process.exit(2)
}

if (cli.action === "help") {
  console.log(HELP_TEXT)
  process.exit(0)
}

if (cli.action === "version") {
  console.log(packageJson.version)
  process.exit(0)
}

mkdirSync(dirname(cli.dataFile), { recursive: true })
const database = new WorkaholicDatabase(cli.dataFile)
const expiredTimers = database.reconcileExpiredTimers()
let closed = false

const closeDatabase = () => {
  if (closed) return
  closed = true
  database.close()
}

process.once("exit", closeDatabase)

try {
  await render(() => <WorkaholicApp db={database} expiredTimers={expiredTimers} onExit={closeDatabase} />, {
    exitOnCtrlC: false,
    targetFps: 30,
    maxFps: 60,
    useMouse: false,
    backgroundColor: "#0f1419",
  })
} catch (error) {
  closeDatabase()
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exitCode = 1
}
