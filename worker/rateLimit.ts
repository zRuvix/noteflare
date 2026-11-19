/**
 * Per-IP limits on requests that can be used to guess secrets: API tokens and the
 * first-run setup. Uses Workers rate-limit bindings (wrangler.jsonc `ratelimits`).
 * A deployment whose config has no binding is simply not limited.
 */
export interface RateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

/** Seconds a client should wait; both bindings count per 60-second window. */
export const RETRY_AFTER_S = 60

/** True when this client is over the limit. A missing or failing binding never blocks. */
export async function isRateLimited(limiter: RateLimiter | undefined, req: Request): Promise<boolean> {
  if (!limiter) return false
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown'
  try {
    return !(await limiter.limit({ key: ip })).success
  } catch {
    return false
  }
}

export const rateLimitedBody = {
  error: 'rate_limited',
  message: `Too many requests. Try again in ${RETRY_AFTER_S} seconds.`,
} as const
