import { AuthError } from "./errors.js";

/** RFC5322-ish; used only to reject email mistaken for User.id at write boundaries. */
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmailUserId(value: string): boolean {
  return EMAIL_LIKE.test(value.trim());
}

/**
 * Ensures a value is suitable for persisted owner keys (better-auth User.id).
 * Email must never be stored as userId / owner_user_id.
 */
export function assertInternalUserId(
  userId: string,
  field = "userId",
): asserts userId is string {
  const trimmed = userId.trim();
  if (!trimmed) {
    throw new AuthError(
      "invalid_user_id",
      `${field} must be a non-empty internal user id`,
    );
  }
  if (isLikelyEmailUserId(trimmed)) {
    throw new AuthError(
      "invalid_user_id",
      `${field} must be better-auth User.id, not an email address`,
    );
  }
}
