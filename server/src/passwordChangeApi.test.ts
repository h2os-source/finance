import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

test("authenticated password change verifies credentials and preserves local user data and session", async () => {
  const previousEnvironment = {
    port: process.env.PORT,
    dataDirectory: process.env.FINANCE_DATA_DIR,
    nodeEnvironment: process.env.NODE_ENV,
  };
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "finance-password-change-api-"));
  process.env.PORT = "0";
  process.env.FINANCE_DATA_DIR = dataDirectory;
  process.env.NODE_ENV = "test";

  let backend: typeof import("./index.js") | undefined;
  try {
    backend = await import("./index.js");
    const { server } = backend;
    if (!server.listening) await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const origin = `http://127.0.0.1:${address.port}`;

    const setup = await fetch(`${origin}/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Local User", password: "current-password-2026!" }),
    });
    assert.equal(setup.status, 201);
    const setCookie = setup.headers.get("set-cookie");
    assert.ok(setCookie);
    const cookie = setCookie.split(";")[0];
    const request = (url: string, method = "GET", body?: unknown, authenticated = true) => fetch(`${origin}${url}`, {
      method,
      headers: {
        ...(authenticated ? { Cookie: cookie } : {}),
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const changeRequest = (currentPassword: string, newPassword: string, confirmNewPassword: string, authenticated = true) =>
      request("/api/auth/password", "PUT", { currentPassword, newPassword, confirmNewPassword }, authenticated);

    assert.equal((await changeRequest(
      "current-password-2026!",
      "new-password-2026-is-valid!",
      "new-password-2026-is-valid!",
      false,
    )).status, 401);

    const financialEntry = await request("/api/entries", "POST", {
      kind: "income",
      amountCents: 90_000,
      category: "Salary",
      description: "Preserved entry",
      entryDate: "2026-11-19",
    });
    assert.equal(financialEntry.status, 201);
    const before = backend.db.prepare(
      `SELECT display_name AS displayName, password_salt AS passwordSalt, password_hash AS passwordHash,
              created_at AS createdAt
       FROM app_user WHERE id = 1`,
    ).get() as { displayName: string; passwordSalt: string; passwordHash: string; createdAt: string };
    const sessionsBefore = (backend.db.prepare("SELECT COUNT(*) AS count FROM session").get() as { count: number }).count;
    const entriesBefore = backend.db.prepare(
      "SELECT kind, amount_cents AS amountCents, category, description, entry_date AS entryDate FROM finance_entry",
    ).all();

    const wrongCurrent = await changeRequest("incorrect-current-password", "new-password-2026-is-valid!", "new-password-2026-is-valid!");
    assert.equal(wrongCurrent.status, 400);
    assert.deepEqual(await wrongCurrent.json(), { error: "Current password is incorrect." });

    const mismatch = await changeRequest("current-password-2026!", "new-password-2026-is-valid!", "different-new-password!");
    assert.equal(mismatch.status, 400);
    assert.deepEqual(await mismatch.json(), { error: "New passwords do not match." });

    const invalidNewPassword = await changeRequest("current-password-2026!", "short", "short");
    assert.equal(invalidNewPassword.status, 400);
    assert.deepEqual(await invalidNewPassword.json(), { error: "Choose a password between 12 and 256 characters." });

    const newPassword = "new-password-2026-is-valid!";
    const changed = await changeRequest("current-password-2026!", newPassword, newPassword);
    assert.equal(changed.status, 204);
    assert.equal(await changed.text(), "");

    const after = backend.db.prepare(
      `SELECT display_name AS displayName, password_salt AS passwordSalt, password_hash AS passwordHash,
              created_at AS createdAt
       FROM app_user WHERE id = 1`,
    ).get() as typeof before;
    assert.notEqual(after.passwordSalt, before.passwordSalt);
    assert.notEqual(after.passwordHash, before.passwordHash);
    assert.notEqual(after.passwordHash, newPassword);
    assert.equal(after.displayName, before.displayName);
    assert.equal(after.createdAt, before.createdAt);
    assert.equal((backend.db.prepare("SELECT COUNT(*) AS count FROM app_user").get() as { count: number }).count, 1);
    assert.equal((backend.db.prepare("SELECT COUNT(*) AS count FROM session").get() as { count: number }).count, sessionsBefore);
    assert.deepEqual(backend.db.prepare(
      "SELECT kind, amount_cents AS amountCents, category, description, entry_date AS entryDate FROM finance_entry",
    ).all(), entriesBefore);

    const activeSession = await request("/api/auth/status");
    assert.equal(activeSession.status, 200);
    assert.equal((await activeSession.json() as { authenticated: boolean }).authenticated, true);

    const oldPasswordLogin = await request("/api/auth/login", "POST", { password: "current-password-2026!" }, false);
    assert.equal(oldPasswordLogin.status, 401);
    const newPasswordLogin = await request("/api/auth/login", "POST", { password: newPassword }, false);
    assert.equal(newPasswordLogin.status, 200);
    assert.deepEqual(await newPasswordLogin.json(), { displayName: "Local User" });
  } finally {
    if (backend) {
      if (backend.server.listening) {
        await new Promise<void>((resolve, reject) => {
          backend?.server.close((error) => error ? reject(error) : resolve());
        });
      }
      backend.db.close();
    }
    if (previousEnvironment.port === undefined) delete process.env.PORT;
    else process.env.PORT = previousEnvironment.port;
    if (previousEnvironment.dataDirectory === undefined) delete process.env.FINANCE_DATA_DIR;
    else process.env.FINANCE_DATA_DIR = previousEnvironment.dataDirectory;
    if (previousEnvironment.nodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment.nodeEnvironment;
    rmSync(dataDirectory, { recursive: true, force: true });
  }
});
