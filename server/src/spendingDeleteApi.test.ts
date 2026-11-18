import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

test("DELETE /api/entries removes only Spending entries and returns a successful response", async () => {
  const previousEnvironment = {
    port: process.env.PORT,
    dataDirectory: process.env.FINANCE_DATA_DIR,
    nodeEnvironment: process.env.NODE_ENV,
  };
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "finance-spending-delete-api-"));
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
      body: JSON.stringify({ displayName: "Test User", password: "Valid-passphrase-2026!" }),
    });
    assert.equal(setup.status, 201);
    const sessionCookie = setup.headers.get("set-cookie");
    assert.ok(sessionCookie);
    const cookie = sessionCookie.split(";")[0];
    const request = (url: string, method = "GET", body?: unknown) => fetch(`${origin}${url}`, {
      method,
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const manualSpending = await request("/api/entries", "POST", {
      kind: "spending",
      amountCents: 4100,
      category: "Groceries",
      description: "Manual entry",
      entryDate: "2026-11-05",
    });
    assert.equal(manualSpending.status, 201);
    const importedSpending = await request("/api/entries/import", "POST", {
      entries: [{
        kind: "spending",
        amountCents: 5900,
        category: "Transport",
        description: "Imported entry",
        entryDate: "2026-11-06",
      }],
      bills: [],
    });
    assert.equal(importedSpending.status, 201);
    const income = await request("/api/entries", "POST", {
      kind: "income",
      amountCents: 65000,
      category: "Salary",
      description: "Pay",
      entryDate: "2026-11-01",
    });
    assert.equal(income.status, 201);
    const upcomingBill = await request("/api/planner", "POST", {
      kind: "bill",
      name: "Upcoming bill",
      provider: "Utility",
      amountCents: 2500,
      dueDate: "2026-11-25",
      recurrence: "none",
      notes: "",
    });
    assert.equal(upcomingBill.status, 201);
    const paidBill = await request("/api/entries/import", "POST", {
      entries: [],
      bills: [{
        name: "Paid bill",
        provider: "Utility",
        amountCents: 1300,
        transactionDate: "2026-11-03",
        notes: "Statement payment",
      }],
    });
    assert.equal(paidBill.status, 201);

    const deletion = await request("/api/entries", "DELETE");
    assert.equal(deletion.status, 200);
    assert.deepEqual(await deletion.json(), { deleted: 2 });
    assert.deepEqual(await (await request("/api/entries?kind=spending")).json(), []);
    assert.equal((await (await request("/api/entries?kind=income")).json() as unknown[]).length, 1);
    const bills = await (await request("/api/planner?kind=bill")).json() as Array<{ status: string }>;
    assert.deepEqual(new Set(bills.map((bill) => bill.status)), new Set(["upcoming", "paid"]));
    const dashboard = await (await request("/api/dashboard")).json() as { monthlySpendingCents: number };
    assert.equal(dashboard.monthlySpendingCents, 1300);
    const emptyDeletion = await request("/api/entries", "DELETE");
    assert.equal(emptyDeletion.status, 200);
    assert.deepEqual(await emptyDeletion.json(), { deleted: 0 });
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
