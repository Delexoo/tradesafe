/**
 * Sliding-window rate limiter (in-memory per runtime, optional DB backing).
 * Mirrors src/lib/rate-limit.ts for the vanilla server path.
 */

const memoryStore = new Map();

export class RateLimitError extends Error {
  constructor(message = "Rate limit exceeded", retryAfterSec = 60) {
    super(message);
    this.name = "RateLimitError";
    this.status = 429;
    this.retryAfterSec = retryAfterSec;
  }
}

function memoryCheck(key, limit, windowMs, now) {
  const existing = memoryStore.get(key);
  if (!existing || now - existing.windowStart >= windowMs) {
    memoryStore.set(key, { count: 1, windowStart: now });
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(now + windowMs),
    };
  }
  if (existing.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(existing.windowStart + windowMs),
    };
  }
  existing.count += 1;
  return {
    allowed: true,
    remaining: limit - existing.count,
    resetAt: new Date(existing.windowStart + windowMs),
  };
}

async function dbCheck(supabase, key, limit, windowMs, now) {
  const windowStartIso = now.toISOString();
  const { data: row, error: readError } = await supabase
    .from("ts_rate_limits")
    .select("count, window_start")
    .eq("key", key)
    .maybeSingle();

  if (readError) {
    return memoryCheck(key, limit, windowMs, now.getTime());
  }

  const windowStart = row?.window_start ? new Date(row.window_start).getTime() : 0;
  const elapsed = now.getTime() - windowStart;

  if (!row || elapsed >= windowMs) {
    const { error: upsertError } = await supabase.from("ts_rate_limits").upsert({
      key,
      count: 1,
      window_start: windowStartIso,
    });
    if (upsertError) {
      return memoryCheck(key, limit, windowMs, now.getTime());
    }
    return {
      allowed: true,
      remaining: limit - 1,
      resetAt: new Date(now.getTime() + windowMs),
    };
  }

  if (row.count >= limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: new Date(windowStart + windowMs),
    };
  }

  const nextCount = row.count + 1;
  const { error: updateError } = await supabase
    .from("ts_rate_limits")
    .update({ count: nextCount })
    .eq("key", key);

  if (updateError) {
    return memoryCheck(key, limit, windowMs, now.getTime());
  }

  return {
    allowed: true,
    remaining: limit - nextCount,
    resetAt: new Date(windowStart + windowMs),
  };
}

export async function checkRateLimit(key, limit, windowMs, options = {}) {
  const now = new Date();
  if (options.supabase) {
    return dbCheck(options.supabase, key, limit, windowMs, now);
  }
  return memoryCheck(key, limit, windowMs, now.getTime());
}

export async function assertRateLimit(key, limit, windowMs, options = {}) {
  const result = await checkRateLimit(key, limit, windowMs, options);
  if (!result.allowed) {
    const retryAfterSec = Math.max(
      1,
      Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
    );
    throw new RateLimitError("Too many requests. Try again shortly.", retryAfterSec);
  }
  return result;
}

export function resetRateLimitMemoryStore() {
  memoryStore.clear();
}
