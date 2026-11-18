import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type Database from "better-sqlite3";

const scrypt = promisify(scryptCallback);
const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 14;
const KEY_LENGTH = 64;

export interface AuthUser {
  displayName: string;
}

export interface AuthService {
  hasUser(): boolean;
  createUser(displayName: string, password: string): Promise<void>;
  verifyPassword(password: string): Promise<AuthUser | null>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  createSession(): { token: string; expiresAt: number };
  getSession(token: string): AuthUser | null;
  deleteSession(token: string): void;
}

export function createAuthService(db: Database.Database): AuthService {
  const userRow = db.prepare(
    "SELECT display_name AS displayName, password_salt AS passwordSalt, password_hash AS passwordHash FROM app_user WHERE id = 1",
  );

  return {
    hasUser: () => Boolean(userRow.get()),
    async createUser(displayName, password) {
      const name = displayName.trim();
      if (name.length < 1 || name.length > 80) {
        throw new Error("Enter a name between 1 and 80 characters.");
      }
      validatePassword(password);
      if (userRow.get()) {
        throw new Error("An account has already been set up.");
      }

      const salt = randomBytes(16);
      const hash = (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
      const create = db.transaction(() => {
        if (userRow.get()) throw new Error("An account has already been set up.");
        db.prepare(
        "INSERT INTO app_user (id, display_name, password_salt, password_hash) VALUES (1, ?, ?, ?)",
        ).run(name, salt.toString("hex"), hash.toString("hex"));
      });
      create();
    },
    async verifyPassword(password) {
      if (password.length > 256) return null;
      const user = userRow.get() as
        | { displayName: string; passwordSalt: string; passwordHash: string }
        | undefined;
      if (!user || !(await passwordMatches(password, user.passwordSalt, user.passwordHash))) return null;
      return { displayName: user.displayName };
    },
    async changePassword(currentPassword, newPassword) {
      const user = userRow.get() as
        | { displayName: string; passwordSalt: string; passwordHash: string }
        | undefined;
      if (!user || !(await passwordMatches(currentPassword, user.passwordSalt, user.passwordHash))) {
        throw new Error("Current password is incorrect.");
      }
      validatePassword(newPassword);

      const salt = randomBytes(16);
      const hash = (await scrypt(newPassword, salt, KEY_LENGTH)) as Buffer;
      const result = db.prepare(
        `UPDATE app_user SET password_salt = ?, password_hash = ?
         WHERE id = 1 AND password_salt = ? AND password_hash = ?`,
      ).run(salt.toString("hex"), hash.toString("hex"), user.passwordSalt, user.passwordHash);
      if (result.changes !== 1) throw new Error("Current password is incorrect.");
    },
    createSession() {
      const token = randomBytes(32).toString("base64url");
      const expiresAt = Date.now() + SESSION_DURATION_MS;
      db.prepare("INSERT INTO session (token_hash, expires_at) VALUES (?, ?)").run(
        hashToken(token),
        expiresAt,
      );
      return { token, expiresAt };
    },
    getSession(token) {
      const now = Date.now();
      db.prepare("DELETE FROM session WHERE expires_at <= ?").run(now);
      const valid = db
        .prepare(
          `SELECT app_user.display_name AS displayName
           FROM session CROSS JOIN app_user
           WHERE session.token_hash = ? AND session.expires_at > ? AND app_user.id = 1`,
        )
        .get(hashToken(token), now) as AuthUser | undefined;
      return valid ?? null;
    },
    deleteSession(token) {
      db.prepare("DELETE FROM session WHERE token_hash = ?").run(hashToken(token));
    },
  };
}

async function passwordMatches(password: string, saltHex: string, hashHex: string): Promise<boolean> {
  if (password.length > 256) return false;
  const salt = Buffer.from(saltHex, "hex");
  const storedHash = Buffer.from(hashHex, "hex");
  const candidateHash = (await scrypt(password, salt, storedHash.length)) as Buffer;
  return candidateHash.length === storedHash.length && timingSafeEqual(candidateHash, storedHash);
}

function validatePassword(password: string): void {
  if (password.length < 12 || password.length > 256) {
    throw new Error("Choose a password between 12 and 256 characters.");
  }
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
