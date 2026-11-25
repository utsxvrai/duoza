import nacl from "tweetnacl"

/** 31 characters: A-Z and 2-9 without the look-alikes 0, O, 1, I, L. */
export const PAIRING_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

const CODE_LENGTH = 6
// Largest multiple of the alphabet size below 256, for unbiased rejection sampling.
const REJECT_AT = 256 - (256 % PAIRING_ALPHABET.length)

/** Random one-time code shown to the inviter, formatted for reading aloud: "K7P-42Q". */
export function generatePairingCode(): string {
  const chars: string[] = []
  while (chars.length < CODE_LENGTH) {
    for (const byte of nacl.randomBytes(16)) {
      if (byte < REJECT_AT && chars.length < CODE_LENGTH) {
        chars.push(PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length] as string)
      }
    }
  }
  return `${chars.slice(0, 3).join("")}-${chars.slice(3).join("")}`
}

/** Canonical form for lookup ("K7P42Q"), or null when the input can't be a code. */
export function normalizePairingCode(input: string): string | null {
  const compact = input.toUpperCase().replace(/[\s-]/g, "")
  if (compact.length !== CODE_LENGTH) return null
  for (const ch of compact) {
    if (!PAIRING_ALPHABET.includes(ch)) return null
  }
  return compact
}
