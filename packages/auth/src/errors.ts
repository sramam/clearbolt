export class AuthError extends Error {
  constructor(
    public readonly code:
      | "unauthorized"
      | "unimplemented"
      | "forbidden"
      | "invalid_user_id",
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
