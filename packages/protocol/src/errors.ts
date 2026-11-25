export type ProtocolErrorCode = "bad_encoding" | "invalid_envelope" | "invalid_payload" | "wrong_recipient" | "decrypt_failed" | "header_mismatch"

export class DuozaProtocolError extends Error {
  readonly code: ProtocolErrorCode

  constructor(code: ProtocolErrorCode, message: string) {
    super(message)
    this.name = "DuozaProtocolError"
    this.code = code
  }
}
