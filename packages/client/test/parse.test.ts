import { describe, expect, it } from "vitest"
import { parseCommand } from "../src/parse.js"

describe("parseCommand", () => {
  it("parses each command from the text a person typed", () => {
    expect(parseCommand("request", "Priyanshi")).toEqual({ cmd: "request", name: "Priyanshi" })
    expect(parseCommand("pair", "Utsav  k7p-42q")).toEqual({ cmd: "pair", name: "Utsav", code: "k7p-42q" })
    expect(parseCommand("send", "Priyanshi kal ka bug fix ho gaya")).toEqual({ cmd: "send", name: "Priyanshi", text: "kal ka bug fix ho gaya" })
    expect(parseCommand("query", "Priyanshi auth ke tests chala")).toEqual({ cmd: "query", name: "Priyanshi", text: "auth ke tests chala" })
    expect(parseCommand("accept", " 7 ")).toEqual({ cmd: "accept", number: 7 })
    expect(parseCommand("reject", "7")).toEqual({ cmd: "reject", number: 7 })
    expect(parseCommand("show", "7")).toEqual({ cmd: "show", number: 7 })
    expect(parseCommand("peers", "")).toEqual({ cmd: "peers" })
    expect(parseCommand("unpair", "Priyanshi")).toEqual({ cmd: "unpair", name: "Priyanshi" })
    expect(parseCommand("whoami", "")).toEqual({ cmd: "whoami" })
  })

  it("keeps shell-looking text as plain message text", () => {
    expect(parseCommand("send", 'P hi; echo INJECTED $(whoami) `id` "q" it\'s')).toEqual({
      cmd: "send",
      name: "P",
      text: 'hi; echo INJECTED $(whoami) `id` "q" it\'s',
    })
  })

  it("keeps multi-line message text", () => {
    expect(parseCommand("send", "P line one\nline two")).toEqual({ cmd: "send", name: "P", text: "line one\nline two" })
  })

  it("returns a usage error for missing pieces or unknown commands", () => {
    expect(parseCommand("send", "Priyanshi")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("pair", "Utsav")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("accept", "seven")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("accept", "0")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("explode", "")).toMatchObject({ error: expect.stringContaining("unknown command") })
  })
})
