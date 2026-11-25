export type ClientErrorCode =
  | "invalid_name"
  | "name_taken"
  | "already_paired"
  | "unknown_peer"
  | "bad_code"
  | "rate_limited"
  | "not_found"
  | "already_handled"
  | "not_accepted"
  | "not_paired"
  | "relay_error"
  | "relay_unreachable"
  | "timeout"

export class DuozaClientError extends Error {
  readonly code: ClientErrorCode

  constructor(code: ClientErrorCode, message: string) {
    super(message)
    this.name = "DuozaClientError"
    this.code = code
  }
}
