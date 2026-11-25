import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { planInstall, planUninstall, startArgs, syncMarketplace } from "../src/launcher.js"

const DIR = "/home/x/.duoza/marketplace"

describe("planInstall", () => {
  it("fresh machine: add the marketplace, then install the plugin", () => {
    expect(planInstall({ marketplaceDir: DIR, marketplaces: [], plugins: [] })).toEqual([
      ["plugin", "marketplace", "add", DIR],
      ["plugin", "install", "duoza@duoza"],
    ])
  })

  it("already set up: just refresh the marketplace", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duoza@duoza", enabled: true }],
      }),
    ).toEqual([["plugin", "marketplace", "update", "duoza"]])
  })

  it("a 'duoza' marketplace from somewhere else is replaced by this one", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: "/old/place" }],
        plugins: [{ id: "duoza@duoza", enabled: true }],
      }),
    ).toEqual([
      ["plugin", "marketplace", "remove", "duoza"],
      ["plugin", "marketplace", "add", DIR],
      ["plugin", "install", "duoza@duoza"],
    ])
  })

  it("re-enables a disabled install", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duoza@duoza", enabled: false }],
      }),
    ).toEqual([
      ["plugin", "marketplace", "update", "duoza"],
      ["plugin", "enable", "duoza@duoza"],
    ])
  })

  it("disables other enabled copies of the plugin so only one duoza server runs", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [
          { name: "duoza", path: DIR },
          { name: "duoza-local", path: "/dev/duoza" },
        ],
        plugins: [
          { id: "duoza@duoza", enabled: true },
          { id: "duoza@duoza-local", enabled: true },
        ],
      }),
    ).toEqual([
      ["plugin", "marketplace", "update", "duoza"],
      ["plugin", "disable", "duoza@duoza-local"],
    ])
  })
})

describe("planUninstall", () => {
  it("removes the plugin and the marketplace when present", () => {
    expect(
      planUninstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duoza@duoza", enabled: true }],
      }),
    ).toEqual([
      ["plugin", "uninstall", "duoza@duoza"],
      ["plugin", "marketplace", "remove", "duoza"],
    ])
    expect(planUninstall({ marketplaceDir: DIR, marketplaces: [], plugins: [] })).toEqual([])
  })
})

describe("startArgs", () => {
  it("loads the duoza channel and passes the user's own args through", () => {
    expect(startArgs(["--resume"])).toEqual(["--dangerously-load-development-channels", "plugin:duoza@duoza", "--resume"])
  })
})

describe("syncMarketplace", () => {
  function source(version: string): string {
    const src = mkdtempSync(join(tmpdir(), "duoza-src-"))
    mkdirSync(join(src, ".claude-plugin"), { recursive: true })
    writeFileSync(join(src, ".claude-plugin", "marketplace.json"), JSON.stringify({ name: "duoza", v: version }))
    return src
  }

  it("copies into a stable place, and only again when the version changes", () => {
    const target = join(mkdtempSync(join(tmpdir(), "duoza-home-")), "marketplace")
    expect(syncMarketplace(source("1"), target, "0.1.0")).toBe(true)
    expect(readFileSync(join(target, ".claude-plugin", "marketplace.json"), "utf8")).toContain('"v":"1"')
    expect(syncMarketplace(source("2"), target, "0.1.0")).toBe(false)
    expect(readFileSync(join(target, ".claude-plugin", "marketplace.json"), "utf8")).toContain('"v":"1"')
    expect(syncMarketplace(source("3"), target, "0.2.0")).toBe(true)
    expect(readFileSync(join(target, ".claude-plugin", "marketplace.json"), "utf8")).toContain('"v":"3"')
    expect(existsSync(join(target, "VERSION"))).toBe(true)
  })
})
