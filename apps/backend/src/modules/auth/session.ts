const SESSION_DURATION_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;
const SESSION_TOKEN_BYTES = 32;

export type SessionMaterial = {
  token: string;
  tokenHash: string;
  expiresAt: Date;
};

export function createSessionMaterial(now = new Date()): SessionMaterial {
  const tokenBytes = crypto.getRandomValues(new Uint8Array(SESSION_TOKEN_BYTES));
  const token = Buffer.from(tokenBytes).toString("base64url");

  return {
    token,
    tokenHash: hashSessionToken(token),
    expiresAt: new Date(now.getTime() + SESSION_DURATION_MILLISECONDS),
  };
}

export function hashSessionToken(token: string): string {
  return new Bun.CryptoHasher("sha256").update(token).digest("base64url");
}
