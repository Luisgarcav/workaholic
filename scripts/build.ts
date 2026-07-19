import { mkdirSync } from "node:fs"
import { resolve } from "node:path"
import solidPlugin from "@opentui/solid/bun-plugin"

type BuildName = "linux-x64" | "macos-x64" | "macos-arm64"

const builds: Record<BuildName, { target: "bun-linux-x64" | "bun-darwin-x64" | "bun-darwin-arm64"; outfile: string; libc?: "glibc" }> = {
  "linux-x64": { target: "bun-linux-x64", outfile: "workaholic-linux-x64", libc: "glibc" },
  "macos-x64": { target: "bun-darwin-x64", outfile: "workaholic-macos-x64" },
  "macos-arm64": { target: "bun-darwin-arm64", outfile: "workaholic-macos-arm64" },
}

const requested = process.argv[2]
const names: BuildName[] =
  requested === "linux-x64"
    ? ["linux-x64"]
    : requested === "macos"
      ? ["macos-x64", "macos-arm64"]
      : requested === undefined
        ? ["linux-x64", "macos-x64", "macos-arm64"]
        : (() => {
            throw new Error(`Unknown target: ${requested}`)
          })()

const outdir = resolve("dist")
mkdirSync(outdir, { recursive: true })

for (const name of names) {
  const config = builds[name]
  const result = await Bun.build({
    entrypoints: [resolve("src/index.tsx")],
    plugins: [solidPlugin],
    minify: true,
    sourcemap: "none",
    define: config.libc ? { "process.env.OPENTUI_LIBC": JSON.stringify(config.libc) } : undefined,
    compile: {
      target: config.target,
      outfile: resolve(outdir, config.outfile),
    },
  })

  if (!result.success) {
    for (const log of result.logs) console.error(log)
    process.exit(1)
  }
  console.log(`✓ dist/${config.outfile}`)
}
