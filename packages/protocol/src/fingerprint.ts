import { createHash } from "node:crypto"
import { fromB64 } from "./encoding.js"

/** 64 visually distinct, easy-to-name emoji: each one encodes 6 bits. */
const EMOJI = [
  "🐶",
  "🐱",
  "🦊",
  "🐻",
  "🐼",
  "🐨",
  "🐯",
  "🦁",
  "🐮",
  "🐷",
  "🐸",
  "🐵",
  "🐔",
  "🐧",
  "🦉",
  "🐝",
  "🦋",
  "🐢",
  "🐍",
  "🐙",
  "🦀",
  "🐬",
  "🐳",
  "🦈",
  "🐘",
  "🦒",
  "🦓",
  "🐪",
  "🦘",
  "🦔",
  "🐿️",
  "🦚",
  "🌵",
  "🌲",
  "🌻",
  "🌹",
  "🍁",
  "🍄",
  "🌙",
  "⭐",
  "🔥",
  "🌈",
  "❄️",
  "⚡",
  "🌊",
  "🍎",
  "🍌",
  "🍇",
  "🍉",
  "🍍",
  "🥕",
  "🌽",
  "🍕",
  "🍩",
  "🎸",
  "🥁",
  "🎈",
  "🎁",
  "🚀",
  "🚲",
  "⚓",
  "🔑",
  "💡",
  "📚",
] as const

/**
 * Order-independent 4-emoji fingerprint of two signing keys.
 * Both people see the same emoji only if each holds the other's real key,
 * so comparing them out-of-band detects a relay-in-the-middle.
 */
export function fingerprint(signPublicKeyA: string, signPublicKeyB: string): string[] {
  const [first, second] = [signPublicKeyA, signPublicKeyB].sort()
  const digest = createHash("sha256")
    .update("duoza-fingerprint-v1")
    .update(fromB64(first as string))
    .update(fromB64(second as string))
    .digest()
  // 24 bits -> four 6-bit indexes.
  const bits = ((digest[0] as number) << 16) | ((digest[1] as number) << 8) | (digest[2] as number)
  return [18, 12, 6, 0].map((shift) => EMOJI[(bits >> shift) & 0x3f] as string)
}
