/** One change as the other devices hear about it: which note, and its new version (0 = deleted). */
export interface LiveChange {
  id: string
  version: number
}

/** The socket message. Picks the two fields on purpose: nothing else may ever leave through it. */
export function liveMessage(changes: { id: string; version: number }[]): string {
  return JSON.stringify({ type: 'changed', notes: changes.map(({ id, version }) => ({ id, version })) })
}

/**
 * Tell the user's other open devices to pull. One Durable Object per user, so a socket only
 * hears about its owner's notes. Does nothing when the LIVE binding is missing (older configs).
 */
export function notifyLive(
  env: { LIVE?: DurableObjectNamespace },
  ctx: { waitUntil(p: Promise<unknown>): void },
  user: string,
  changes: LiveChange[],
) {
  if (!env.LIVE || changes.length === 0) return
  const stub = env.LIVE.get(env.LIVE.idFromName(user))
  ctx.waitUntil(
    stub.fetch('https://live/notify', { method: 'POST', body: liveMessage(changes) }).then(
      () => undefined,
      () => undefined,
    ),
  )
}
