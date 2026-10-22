import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    throw new AuthError("Unauthorized");
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("ts_profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (!profile) {
    await admin.from("ts_profiles").insert({
      id: user.id,
      display_name:
        (user.user_metadata?.display_name as string) ||
        user.email?.split("@")[0] ||
        "Trader",
    });
  }

  return { user, supabase };
}

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export function jsonError(error: unknown, fallback = 500) {
  if (error instanceof AuthError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Server error";
  const status =
    message === "Forbidden"
      ? 403
      : message.includes("not found") || message.includes("Invalid")
        ? 404
        : fallback;
  return Response.json({ error: message }, { status });
}
