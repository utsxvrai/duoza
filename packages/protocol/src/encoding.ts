import { DuozaProtocolError } from "./errors.js"

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/

export function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64")
}

/** Strict base64 decode: Buffer.from silently skips invalid characters, so validate first. */
export function fromB64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !B64_RE.test(value)) {
    throw new DuozaProtocolError("bad_encoding", "invalid base64")
  }
  return new Uint8Array(Buffer.from(value, "base64"))
}

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

export function fromUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes)
}
