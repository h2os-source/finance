import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { test } from "node:test";
import { createDatabase } from "./database";
import {
  createEntry,
  getBudgetBuilderSummary,
  listBudgets,
  saveBudgets,
} from "./finance";
import {
  BUDGET_CATEGORIES,
  BUDGET_GROUPS,
  calculateBudgetAllocations,
  calculateBudgetSummary,
  getSavingsGoalWarning,
} from "./budget";

test("budget groups expose the required ordered categories", () => {
  assert.deepEqual(BUDGET_GROUPS, ["Essentials", "Savings & Goals", "Lifestyle", "Luxury", "Other"]);
  assert.deepEqual(Object.keys(BUDGET_CATEGORIES), [...BUDGET_GROUPS]);
  assert.deepEqual(BUDGET_CATEGORIES.Essentials, [
    "Groceries", "Fuel / Transport", "Medical / Health", "Household", "Education / Children", "Pet costs",
  ]);
  assert.deepEqual(BUDGET_CATEGORIES["Savings & Goals"], [
    "Emergency fund", "General savings", "Investing", "Extra mortgage repayment", "Extra debt repayment",
    "Holiday / major purchase goal",
  ]);
  assert.deepEqual(BUDGET_CATEGORIES.Lifestyle, [
    "Clothing", "Eating out", "Entertainment", "Hobbies", "Gaming", "Subscriptions", "Personal spending",
  ]);
  assert.deepEqual(BUDGET_CATEGORIES.Luxury, [
    "Takeaway coffee", "Premium dining", "Alcohol", "Luxury purchases", "Impulse spending", "Other luxury",
  ]);
  assert.deepEqual(BUDGET_CATEGORIES.Other, ["Other"]);
  const db = createDatabase(":memory:", { seedSampleData: false });
  const saved = saveBudgets(db, BUDGET_GROUPS.map((group) => ({
    group,
    category: group === "Other" ? "Other" : BUDGET_CATEGORIES[group][0],
    limitCents: 10_000,
  })));
  assert.deepEqual(saved.map((budget) => budget.group).sort(
    (left, right) => BUDGET_GROUPS.indexOf(left) - BUDGET_GROUPS.indexOf(right),
  ), [...BUDGET_GROUPS]);
  db.close();
});

test("monthly summary uses recorded income and monthly-equivalent distinct fixed commitments", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  createEntry(db, {
    kind: "income", amountCents: 300_000, category: "Salary", description: "", entryDate: "2026-10-19",
  });
  createEntry(db, {
    kind: "income", amountCents: 300_000, category: "Salary", description: "", entryDate: "2026-11-02",
  });
  const mortgageId = Number(db.prepare(
    "INSERT INTO mortgage (name, balance_cents, repayment_cents, repayment_frequency) VALUES (?, ?, ?, ?)",
  ).run("Home", 10_000_000, 12_000, "weekly").lastInsertRowid);
  db.prepare(
    "INSERT INTO personal_loan (name, type, balance_cents, repayment_cents, repayment_frequency, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run("Car", "car", 1_000_000, 24_000, "fortnightly", "2026-10-01");
  const insertPlanner = db.prepare(
    "INSERT INTO planner_item (kind, status, name, amount_cents, due_date, recurrence, payment_frequency) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insertPlanner.run("bill", "upcoming", "Rates", 30_000, "2026-10-10", "quarterly", "");
  insertPlanner.run("bill", "upcoming", "One-off", 5_000, "2026-10-20", "none", "");
  insertPlanner.run("bill", "paid", "Paid history", 90_000, "2026-10-10", "monthly", "");
  insertPlanner.run("insurance", "upcoming", "Annual cover", 120_000, "2026-10-04", "yearly", "yearly");
  insertPlanner.run("insurance", "upcoming", "One-off cover", 10_000, "2026-10-04", "none", "one-off");

  assert.deepEqual(getBudgetBuilderSummary(db, new Date(2026, 9, 14, 12)), {
    incomeCents: 300_000,
    fixedCommitmentsCents: 129_000,
    month: "2026-10",
  });
  const linkedBudgets = saveBudgets(db, [
    { group: "Essentials", category: "Home loan", limitCents: 52_000, sourceType: "mortgage", sourceId: mortgageId },
    { group: "Essentials", category: "Household", limitCents: 80_000 },
  ]);
  assert.equal(calculateBudgetAllocations(linkedBudgets), 80_000);
  db.close();
});

test("summary arithmetic and allocations keep linked commitments from being deducted twice", () => {
  const totals = calculateBudgetSummary(400_000, 120_000, 200_000);
  assert.deepEqual(totals, { availableCents: 280_000, remainingCents: 80_000, overBudgetCents: 0 });
  assert.equal(calculateBudgetAllocations([
    { limitCents: 120_000, frequency: "monthly", sourceType: "mortgage" },
    { limitCents: 80_000, frequency: "monthly", sourceType: "other" },
  ]), 80_000);
});

test("allocation changes recalculate remaining and over-budget plans remain saveable", () => {
  const under = calculateBudgetSummary(200_000, 50_000, 100_000);
  const over = calculateBudgetSummary(200_000, 50_000, 175_000);
  assert.equal(under.remainingCents, 50_000);
  assert.equal(over.overBudgetCents, 25_000);

  const db = createDatabase(":memory:", { seedSampleData: false });
  const saved = saveBudgets(db, [{ group: "Luxury", category: "Premium dining", limitCents: 175_000 }]);
  assert.equal(saved[0].limitCents, 175_000);
  db.close();
});

test("Other retains custom categories and saved budgets compare against actual Spending", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  createEntry(db, {
    kind: "spending", amountCents: 25_000, category: "Groceries", description: "", entryDate: "2026-10-12",
  });
  saveBudgets(db, [
    { group: "Essentials", category: "Groceries", limitCents: 60_000 },
    { group: "Other", category: "Weekend pottery", limitCents: 12_000 },
  ]);
  const saved = listBudgets(db, "2026-10");
  assert.equal(saved.find((budget) => budget.category === "Groceries")?.spentCents, 25_000);
  assert.equal(saved.find((budget) => budget.category === "Weekend pottery")?.group, "Other");
  assert.equal(listBudgets(db, "2026-10").find((budget) => budget.category === "Weekend pottery")?.limitCents, 12_000);
  db.close();
});

test("a partially funded savings target can warn about Luxury without preventing saving", () => {
  const warning = getSavingsGoalWarning([
    { group: "Savings & Goals", limitCents: 100_000, spentCents: 40_000, frequency: "monthly" },
  ], 25_000);
  assert.deepEqual(warning, { remainingTargetCents: 60_000, luxuryAllocatedCents: 25_000 });
  assert.equal(getSavingsGoalWarning([
    { group: "Savings & Goals", limitCents: 100_000, spentCents: 100_000, frequency: "monthly" },
  ], 25_000), null);

  const db = createDatabase(":memory:", { seedSampleData: false });
  assert.equal(saveBudgets(db, [
    { group: "Savings & Goals", category: "Emergency fund", limitCents: 100_000 },
    { group: "Luxury", category: "Premium dining", limitCents: 25_000 },
  ]).length, 2);
  db.close();
});

test("legacy custom budget rows migrate to Other and remain loadable", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "finance-budget-"));
  const filename = path.join(directory, "legacy.sqlite");
  const legacyDb = new Database(filename);
  legacyDb.exec(`
    CREATE TABLE budget_plan (
      id INTEGER PRIMARY KEY,
      category TEXT NOT NULL UNIQUE,
      limit_cents INTEGER NOT NULL,
      frequency TEXT NOT NULL DEFAULT 'monthly',
      source_type TEXT NOT NULL DEFAULT 'other',
      source_id INTEGER
    );
    INSERT INTO budget_plan (category, limit_cents) VALUES ('My custom category', 42000);
  `);
  legacyDb.close();

  const db = createDatabase(filename, { seedSampleData: false });
  assert.deepEqual(listBudgets(db).map(({ category, group, limitCents }) => ({ category, group, limitCents })), [
    { category: "My custom category", group: "Other", limitCents: 42_000 },
  ]);
  db.close();
  rmSync(directory, { recursive: true, force: true });
});
