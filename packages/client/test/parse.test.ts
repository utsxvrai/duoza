import { describe, expect, it } from "vitest"
import { parseCommand } from "../src/parse.js"

describe("parseCommand", () => {
  it("parses each command from the text a person typed", () => {
    expect(parseCommand("request", "Priyanshi")).toEqual({ cmd: "request", name: "Priyanshi" })
    expect(parseCommand("pair", "Utsav  k7p-42q")).toEqual({ cmd: "pair", name: "Utsav", code: "k7p-42q" })
    expect(parseCommand("send", "Priyanshi kal ka bug fix ho gaya")).toEqual({ cmd: "send", input: "Priyanshi kal ka bug fix ho gaya" })
    expect(parseCommand("query", "Priyanshi auth ke tests chala")).toEqual({ cmd: "query", input: "Priyanshi auth ke tests chala" })
    expect(parseCommand("accept", " 7 ")).toEqual({ cmd: "accept", number: 7 })
    expect(parseCommand("reject", "7")).toEqual({ cmd: "reject", number: 7 })
    expect(parseCommand("show", "7")).toEqual({ cmd: "show", number: 7 })
    expect(parseCommand("peers", "")).toEqual({ cmd: "peers" })
    expect(parseCommand("unpair", "Priyanshi")).toEqual({ cmd: "unpair", name: "Priyanshi" })
    expect(parseCommand("whoami", "")).toEqual({ cmd: "whoami" })
  })

  it("names with spaces become one word joined by underscores", () => {
    expect(parseCommand("request", "Gaurav Sir")).toEqual({ cmd: "request", name: "Gaurav_Sir" })
    expect(parseCommand("unpair", " Gaurav   Sir ")).toEqual({ cmd: "unpair", name: "Gaurav_Sir" })
    expect(parseCommand("pair", "Gaurav Sir K7P-42Q")).toEqual({ cmd: "pair", name: "Gaurav_Sir", code: "K7P-42Q" })
  })

  it("keeps the message text untouched (the name is split off later, against your peers)", () => {
    expect(parseCommand("send", 'P hi; echo INJECTED $(whoami) `id` "q" it\'s')).toEqual({
      cmd: "send",
      input: 'P hi; echo INJECTED $(whoami) `id` "q" it\'s',
    })
    expect(parseCommand("send", "P line one\nline two")).toEqual({ cmd: "send", input: "P line one\nline two" })
  })

  it("names are optional where they can be inferred", () => {
    expect(parseCommand("request", "")).toEqual({ cmd: "request" })
    expect(parseCommand("pair", "K7P-42Q")).toEqual({ cmd: "pair", code: "K7P-42Q" })
    expect(parseCommand("unpair", "")).toEqual({ cmd: "unpair" })
    expect(parseCommand("send", "hello")).toEqual({ cmd: "send", input: "hello" })
    expect(parseCommand("name", "")).toEqual({ cmd: "name" })
    expect(parseCommand("name", "Utsav Rai")).toEqual({ cmd: "name", name: "Utsav_Rai" })
  })

  it("returns a usage error for missing pieces or unknown commands", () => {
    expect(parseCommand("send", "   ")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("pair", "")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("accept", "seven")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("accept", "0")).toMatchObject({ error: expect.stringContaining("usage") })
    expect(parseCommand("explode", "")).toMatchObject({ error: expect.stringContaining("unknown command") })
  })
})
