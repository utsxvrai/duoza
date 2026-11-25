import { createHash } from "node:crypto"
import nacl from "tweetnacl"
import { fromB64, toB64 } from "./encoding.js"

/** Everything a device knows about itself. Secret keys never leave the machine. */
export interface Identity {
  deviceId: string
  signPublicKey: string
  signSecretKey: string
  boxPublicKey: string
  boxSecretKey: string
}

/** What a device shares with the relay and its peers. */
export interface PublicIdentity {
  deviceId: string
  signPublicKey: string
  boxPublicKey: string
}

export function deviceIdFor(signPublicKeyB64: string): string {
  return createHash("sha256").update(fromB64(signPublicKeyB64)).digest("hex").slice(0, 32)
}

export function generateIdentity(): Identity {
  const sign = nacl.sign.keyPair()
  const box = nacl.box.keyPair()
  const signPublicKey = toB64(sign.publicKey)
  return {
    deviceId: deviceIdFor(signPublicKey),
    signPublicKey,
    signSecretKey: toB64(sign.secretKey),
    boxPublicKey: toB64(box.publicKey),
    boxSecretKey: toB64(box.secretKey),
  }
}

export function toPublicIdentity(identity: Identity): PublicIdentity {
  return {
    deviceId: identity.deviceId,
    signPublicKey: identity.signPublicKey,
    boxPublicKey: identity.boxPublicKey,
  }
}

/** Proves to the relay that this connection holds the device's signing key. */
export function signChallenge(identity: Identity, challengeB64: string): string {
  return toB64(nacl.sign.detached(fromB64(challengeB64), fromB64(identity.signSecretKey)))
}

export function verifyChallenge(signPublicKeyB64: string, challengeB64: string, signatureB64: string): boolean {
  try {
    const publicKey = fromB64(signPublicKeyB64)
    const signature = fromB64(signatureB64)
    if (publicKey.length !== nacl.sign.publicKeyLength || signature.length !== nacl.sign.signatureLength) {
      return false
    }
    return nacl.sign.detached.verify(fromB64(challengeB64), signature, publicKey)
  } catch {
    return false
  }
}
