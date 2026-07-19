import { expect, test } from "bun:test"
import { homedir } from "node:os"
import { resolve } from "node:path"
import { parseCli } from "../src/cli.ts"

test("uses one hidden file in the home directory by default", () => {
  expect(parseCli([])).toEqual({ action: "run", dataFile: resolve(homedir(), ".workaholic.db") })
})

test("accepts an explicit data path", () => {
  expect(parseCli(["--data-file", "./portable.db"])).toEqual({
    action: "run",
    dataFile: resolve("./portable.db"),
  })
})

test("rejects unknown options", () => {
  expect(() => parseCli(["--wat"])).toThrow("Unknown option")
})
