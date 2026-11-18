import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { calculateBudgetAllocations, calculateBudgetSummary } from "./budget";

function localDateString(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

test("Budget summary API uses current-month Income entries and refreshes changed or deleted entries", async () => {
  const previousEnvironment = {
    port: process.env.PORT,
    dataDirectory: process.env.FINANCE_DATA_DIR,
    nodeEnvironment: process.env.NODE_ENV,
  };
  const dataDirectory = mkdtempSync(path.join(tmpdir(), "finance-budget-summary-api-"));
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
      headers: { Cookie: cookie, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    const now = new Date();
    const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    const monthDate = localDateString(new Date(now.getFullYear(), now.getMonth(), 10));
    const outsideMonthDate = localDateString(new Date(now.getFullYear(), now.getMonth() - 1, 15));
    const recurringDate = localDateString(new Date(now.getFullYear(), now.getMonth(), 20));
    const createIncome = (amountCents: number, category: string, entryDate: string) => request("/api/entries", "POST", {
      kind: "income",
      amountCents,
      category,
      description: "",
      entryDate,
    });

    const salary = await createIncome(900_000, "Salary", monthDate);
    assert.equal(salary.status, 201);
    const bonus = await createIncome(100_000, "Bonus", monthDate);
    assert.equal(bonus.status, 201);
    const bonusEntry = await bonus.json() as { id: number };
    assert.equal((await createIncome(300_000, "Prior month pay", outsideMonthDate)).status, 201);

    assert.equal((await request("/api/recurring-income", "POST", {
      amountCents: 900_000,
      category: "Salary",
      description: "Monthly pay",
      nextDate: monthDate,
      recurrence: "monthly",
    })).status, 201);
    assert.equal((await request("/api/recurring-income", "POST", {
      amountCents: 25_000,
      category: "Contract",
      description: "Monthly contract",
      nextDate: recurringDate,
      recurrence: "monthly",
    })).status, 201);

    const listedIncome = await request("/api/entries?kind=income");
    assert.equal(listedIncome.status, 200);
    assert.equal((await listedIncome.json() as Array<{ entryDate: string }>).length, 3);

    const summaryResponse = await request("/api/budgets/summary");
    assert.equal(summaryResponse.status, 200);
    const summary = await summaryResponse.json() as {
      incomeCents: number;
      fixedCommitmentsCents: number;
      month: string;
    };
    assert.equal(summary.month, month);
    assert.equal(summary.incomeCents, 1_025_000);
    const available = calculateBudgetSummary(summary.incomeCents, summary.fixedCommitmentsCents, 0);
    assert.equal(available.availableCents, summary.incomeCents - summary.fixedCommitmentsCents);

    const savedBudgets = await request("/api/budgets", "PUT", {
      budgets: [{
        group: "Essentials",
        category: "Groceries",
        limitCents: 200_000,
        frequency: "monthly",
        sourceType: "other",
        sourceId: null,
      }],
    });
    assert.equal(savedBudgets.status, 200);
    const saved = await savedBudgets.json() as Array<{
      limitCents: number;
      frequency: "weekly" | "fortnightly" | "monthly";
      sourceType: "mortgage" | "loan" | "bill" | "insurance" | "other";
    }>;
    const allocatedCents = calculateBudgetAllocations(saved);
    const afterAllocation = calculateBudgetSummary(summary.incomeCents, summary.fixedCommitmentsCents, allocatedCents);
    assert.equal(afterAllocation.remainingCents, afterAllocation.availableCents - allocatedCents);

    const updateBonus = await request(`/api/entries/${bonusEntry.id}`, "PUT", {
      kind: "income",
      amountCents: 50_000,
      category: "Bonus",
      description: "",
      entryDate: monthDate,
    });
    assert.equal(updateBonus.status, 200);
    const updatedSummary = await (await request("/api/budgets/summary")).json() as typeof summary;
    assert.equal(updatedSummary.incomeCents, 975_000);
    assert.equal(calculateBudgetSummary(updatedSummary.incomeCents, updatedSummary.fixedCommitmentsCents, allocatedCents).remainingCents,
      updatedSummary.incomeCents - updatedSummary.fixedCommitmentsCents - allocatedCents);

    assert.equal((await request(`/api/entries/${bonusEntry.id}`, "DELETE")).status, 204);
    const deletedSummary = await (await request("/api/budgets/summary")).json() as typeof summary;
    assert.equal(deletedSummary.incomeCents, 925_000);
    assert.equal((await (await request("/api/entries?kind=income")).json() as unknown[]).length, 2);
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
