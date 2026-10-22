import { NextResponse } from 'next/server';
import { AuthError } from '@/lib/auth';
import { RateLimitError } from '@/lib/rate-limit';
import { InvalidTransitionError } from '@/lib/state-machine';
import { ZodError } from 'zod';

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function handleApiError(error: unknown): NextResponse {
  if (error instanceof AuthError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }
  if (error instanceof RateLimitError) {
    return NextResponse.json(
      { error: error.message },
      {
        status: 429,
        headers: { 'Retry-After': String(error.retryAfterSec) },
      },
    );
  }
  if (error instanceof InvalidTransitionError) {
    return NextResponse.json(
      { error: error.message, from: error.from, to: error.to },
      { status: 409 },
    );
  }
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: 'Validation failed', details: error.flatten() },
      { status: 422 },
    );
  }

  console.error('[api]', error);
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
}
