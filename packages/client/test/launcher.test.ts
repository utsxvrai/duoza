import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { hasSessionInbox, planInstall, planUninstall, startArgs, syncMarketplace } from "../src/launcher.js"

const DIR = "/home/x/.duoza/marketplace"

describe("planInstall", () => {
  it("fresh machine: add the marketplace, then install the plugin", () => {
    expect(planInstall({ marketplaceDir: DIR, marketplaces: [], plugins: [] })).toEqual([
      ["plugin", "marketplace", "add", DIR],
      ["plugin", "install", "duo@duoza"],
    ])
  })

  it("already set up: just refresh the marketplace", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duo@duoza", enabled: true }],
      }),
    ).toEqual([["plugin", "marketplace", "update", "duoza"]])
  })

  it("a 'duoza' marketplace from somewhere else is replaced by this one", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: "/old/place" }],
        plugins: [{ id: "duo@duoza", enabled: true }],
      }),
    ).toEqual([
      ["plugin", "marketplace", "remove", "duoza"],
      ["plugin", "marketplace", "add", DIR],
      ["plugin", "install", "duo@duoza"],
    ])
  })

  it("after copying a new version, updates the existing install so its recorded version matches", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duo@duoza", enabled: true }],
        newVersion: true,
      }),
    ).toEqual([
      ["plugin", "marketplace", "update", "duoza"],
      ["plugin", "update", "duo@duoza"],
    ])
  })

  it("re-enables a disabled install", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duo@duoza", enabled: false }],
      }),
    ).toEqual([
      ["plugin", "marketplace", "update", "duoza"],
      ["plugin", "enable", "duo@duoza"],
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
          { id: "duo@duoza", enabled: true },
          { id: "duoza@duoza-local", enabled: true },
        ],
      }),
    ).toEqual([
      ["plugin", "marketplace", "update", "duoza"],
      ["plugin", "disable", "duoza@duoza-local"],
    ])
  })

  it("upgrading from the old plugin name: uninstalls duoza@duoza, installs duo@duoza", () => {
    expect(
      planInstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duoza@duoza", enabled: true }],
        newVersion: true,
      }),
    ).toEqual([
      ["plugin", "uninstall", "duoza@duoza"],
      ["plugin", "marketplace", "update", "duoza"],
      ["plugin", "install", "duo@duoza"],
    ])
  })
})

describe("planUninstall", () => {
  it("also removes an install under the old plugin name", () => {
    expect(planUninstall({ marketplaceDir: DIR, marketplaces: [{ name: "duoza", path: DIR }], plugins: [{ id: "duoza@duoza", enabled: true }] })).toEqual([
      ["plugin", "uninstall", "duoza@duoza"],
      ["plugin", "marketplace", "remove", "duoza"],
    ])
  })

  it("removes the plugin and the marketplace when present", () => {
    expect(
      planUninstall({
        marketplaceDir: DIR,
        marketplaces: [{ name: "duoza", path: DIR }],
        plugins: [{ id: "duo@duoza", enabled: true }],
      }),
    ).toEqual([
      ["plugin", "uninstall", "duo@duoza"],
      ["plugin", "marketplace", "remove", "duoza"],
    ])
    expect(planUninstall({ marketplaceDir: DIR, marketplaces: [], plugins: [] })).toEqual([])
  })
})

describe("startArgs", () => {
  it("on a Claude Code with the session inbox, needs no dev-channel flag", () => {
    expect(startArgs(["--resume"], "2.1.332 (Claude Code)")).toEqual(["--resume"])
  })

  it("falls back to the dev channel on Claude Code older than the session inbox, or when asked", () => {
    expect(startArgs([], "2.1.200 (Claude Code)")).toEqual(["--dangerously-load-development-channels", "plugin:duo@duoza"])
    expect(startArgs(["--channel", "--resume"], "2.1.332")).toEqual(["--dangerously-load-development-channels", "plugin:duo@duoza", "--resume"])
  })

  it("an unreadable version uses the dev channel to be safe", () => {
    expect(startArgs([], "garbage")).toEqual(["--dangerously-load-development-channels", "plugin:duo@duoza"])
  })
})

describe("hasSessionInbox", () => {
  it("compares the Claude Code version against 2.1.224", () => {
    expect(hasSessionInbox("2.1.224")).toBe(true)
    expect(hasSessionInbox("2.2.0 (Claude Code)")).toBe(true)
    expect(hasSessionInbox("2.1.223")).toBe(false)
    expect(hasSessionInbox("1.9.999")).toBe(false)
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
