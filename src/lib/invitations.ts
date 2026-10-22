import { createHash, randomBytes } from "crypto";
import type { InvitationRecord, ParticipantRole } from "./types";

const TOKEN_BYTES = 32;

export function hashInviteToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/** @deprecated alias — prefer hashInviteToken */
export const hashToken = hashInviteToken;

export function generateInviteToken(): { raw: string; hash: string } {
  const raw = randomBytes(TOKEN_BYTES).toString("base64url");
  return { raw, hash: hashInviteToken(raw) };
}

export function invitationExpiresAt(days = 14): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export type CounterpartyRole = "buyer" | "seller";

export function counterpartyRole(
  creatorRole: CounterpartyRole
): CounterpartyRole {
  return creatorRole === "buyer" ? "seller" : "buyer";
}

export function isJoinableRole(
  role: ParticipantRole
): role is CounterpartyRole {
  return role === "buyer" || role === "seller";
}

export function isInvitationValid(
  inv: InvitationRecord
): { valid: boolean; reason?: string } {
  if (inv.revoked_at) {
    return { valid: false, reason: "revoked" };
  }
  if (new Date(inv.expires_at).getTime() < Date.now()) {
    return { valid: false, reason: "expired" };
  }
  if (inv.use_count >= inv.max_uses) {
    return { valid: false, reason: "exhausted" };
  }
  if (inv.single_use && inv.use_count > 0) {
    return { valid: false, reason: "single_use" };
  }
  return { valid: true };
}
