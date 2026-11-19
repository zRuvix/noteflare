/**
 * Passkeys that unlock the vault, through the WebAuthn PRF extension.
 *
 * A passkey here is not a login (Cloudflare Access does that): it only yields a secret.
 * The PRF extension returns 32 bytes that depend on the passkey and on a salt we pass in;
 * the same passkey and salt always give the same bytes, and they never leave the browser.
 * crypto.ts derives a wrapping key from them. So no server challenge is needed: a fake
 * passkey response can't produce the bytes that unwrap the data key.
 */
import type { PasskeyRecord } from '../../shared/types'
import { fromB64 } from './crypto'

export class PasskeyCancelledError extends Error {}
/** The passkey was created, but its authenticator can't do PRF. */
export class PasskeyNoPrfError extends Error {}

interface PrfResults {
  enabled?: boolean
  results?: { first?: BufferSource }
}

const toB64url = (bytes: ArrayBuffer | Uint8Array) => {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (const x of b) s += String.fromCharCode(x)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const fromB64url = (s: string) => fromB64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4))

const random = (n: number) => crypto.getRandomValues(new Uint8Array(n))

/**
 * True when this browser says it supports PRF. Browsers without
 * PublicKeyCredential.getClientCapabilities (older ones) are treated as unsupported.
 */
export async function passkeysSupported(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === 'undefined' || !window.isSecureContext) return false
    const caps = await (PublicKeyCredential as unknown as { getClientCapabilities?: () => Promise<Record<string, boolean>> }).getClientCapabilities?.()
    return caps?.['extension:prf'] === true
  } catch {
    return false
  }
}

function prfOf(cred: PublicKeyCredential): PrfResults | undefined {
  return (cred.getClientExtensionResults() as { prf?: PrfResults }).prf
}

function cancelled(e: unknown): never {
  if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) throw new PasskeyCancelledError()
  throw e
}

/** Ask for one of `passkeys` and return its id and PRF output. */
export async function getPasskeySecret(passkeys: Pick<PasskeyRecord, 'id' | 'salt'>[]): Promise<{ id: string; prf: BufferSource }> {
  const evalByCredential: Record<string, { first: BufferSource }> = {}
  for (const p of passkeys) evalByCredential[p.id] = { first: fromB64(p.salt) }
  const cred = (await navigator.credentials
    .get({
      publicKey: {
        challenge: random(32),
        allowCredentials: passkeys.map((p) => ({ type: 'public-key', id: fromB64url(p.id) })),
        userVerification: 'required',
        extensions: { prf: { evalByCredential } } as AuthenticationExtensionsClientInputs,
      },
    })
    .catch(cancelled)) as PublicKeyCredential | null
  if (!cred) throw new PasskeyCancelledError()
  const first = prfOf(cred)?.results?.first
  if (!first) throw new PasskeyNoPrfError()
  return { id: toB64url(cred.rawId), prf: first }
}

/** Create a passkey for NoteFlare on this site and return its id and PRF output for `salt`. */
export async function createPasskey(email: string, salt: string): Promise<{ id: string; prf: BufferSource }> {
  const cred = (await navigator.credentials
    .create({
      publicKey: {
        rp: { name: 'NoteFlare' },
        user: { id: random(16), name: email, displayName: email },
        challenge: random(32),
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { residentKey: 'preferred', userVerification: 'required' },
        extensions: { prf: { eval: { first: fromB64(salt) } } } as AuthenticationExtensionsClientInputs,
      },
    })
    .catch(cancelled)) as PublicKeyCredential | null
  if (!cred) throw new PasskeyCancelledError()
  const prf = prfOf(cred)
  if (prf?.enabled === false) throw new PasskeyNoPrfError()
  const id = toB64url(cred.rawId)
  // Most browsers only report PRF support at creation; ask the new passkey once more for the output.
  if (prf?.results?.first) return { id, prf: prf.results.first }
  return getPasskeySecret([{ id, salt }])
}

/** A default name for a new passkey, e.g. "Mac · Chrome". */
export function defaultPasskeyName(ua = navigator.userAgent): string {
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : ''
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return [os, browser].filter(Boolean).join(' · ') || 'Passkey'
}
