import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Shape-compatible with `vscode.SecretStorage` (its methods return
 * `Thenable`, which is structurally the same as `PromiseLike`) without this
 * module importing `vscode`, so authentication logic can run under plain
 * Node in tests.
 */
export interface SecretStore {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export class InMemorySecretStore implements SecretStore {
  private readonly data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.data.get(key);
  }
  async store(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

const TOKEN_HASH_KEY = "codelink.authTokenHash";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Bearer-token authentication for remote access. The raw token is never
 * persisted or logged: only its SHA-256 hash is stored (in VS Code
 * `SecretStorage` in production), and verification uses a constant-time
 * comparison to avoid leaking the token through response-time differences.
 */
export class AuthenticationManager {
  constructor(private readonly store: SecretStore) {}

  /** Generates a new cryptographically random token, replacing any
   * previous one, and returns it. This is the only place the raw token is
   * ever available; callers must show it to the user once and discard it. */
  async generateToken(): Promise<string> {
    const token = randomBytes(32).toString("hex");
    await this.store.store(TOKEN_HASH_KEY, hashToken(token));
    return token;
  }

  async revokeToken(): Promise<void> {
    await this.store.delete(TOKEN_HASH_KEY);
  }

  async hasToken(): Promise<boolean> {
    return (await this.store.get(TOKEN_HASH_KEY)) !== undefined;
  }

  async verify(providedToken: string | undefined): Promise<boolean> {
    if (!providedToken) {
      return false;
    }
    const storedHash = await this.store.get(TOKEN_HASH_KEY);
    if (!storedHash) {
      return false;
    }
    const stored = Buffer.from(storedHash, "hex");
    const provided = Buffer.from(hashToken(providedToken), "hex");
    if (stored.length !== provided.length) {
      return false;
    }
    return timingSafeEqual(stored, provided);
  }
}
