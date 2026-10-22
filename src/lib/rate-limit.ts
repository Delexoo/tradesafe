import type { SupabaseClient } from '@supabase/supabase-js';

interface MemoryBucket {
  count: number;
  windowStart: number;
}

const memoryStore = new Map<string, MemoryBucket>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export class RateLimitError extends Error {
  status = 429;
  constructor(
    message = "Rate limit exceeded",
    public readonly retryAfterSec = 60,
  ) {
    super(message);
    this.name = "RateLimitError";
  }
}

export interface RateLimitOptions {
  /** When set, persists counters in `ts_rate_limits` (service role client). */
  supabase?: SupabaseClient;
}

function memoryCheck(
  key: string,
  limit: number,
  windowMs: number,
  now: number,
): RateLimitResult {
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

async function dbCheck(
  supabase: SupabaseClient,
  key: string,
  limit: number,
  windowMs: number,
  now: Date,
): Promise<RateLimitResult> {
  const windowStartIso = now.toISOString();
  const { data: row, error: readError } = await supabase
    .from('ts_rate_limits')
    .select('count, window_start')
    .eq('key', key)
    .maybeSingle();

  if (readError) {
    return memoryCheck(key, limit, windowMs, now.getTime());
  }

  const windowStart = row?.window_start
    ? new Date(row.window_start).getTime()
    : 0;
  const elapsed = now.getTime() - windowStart;

  if (!row || elapsed >= windowMs) {
    const { error: upsertError } = await supabase.from('ts_rate_limits').upsert({
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
    .from('ts_rate_limits')
    .update({ count: nextCount })
    .eq('key', key);

  if (updateError) {
    return memoryCheck(key, limit, windowMs, now.getTime());
  }

  return {
    allowed: true,
    remaining: limit - nextCount,
    resetAt: new Date(windowStart + windowMs),
  };
}

/**
 * Simple sliding-window limiter (in-memory per runtime, optional DB backing).
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  options: RateLimitOptions = {},
): Promise<RateLimitResult> {
  const now = new Date();
  if (options.supabase) {
    return dbCheck(options.supabase, key, limit, windowMs, now);
  }
  return memoryCheck(key, limit, windowMs, now.getTime());
}

/** Test helper */
export function resetRateLimitMemoryStore(): void {
  memoryStore.clear();
}
