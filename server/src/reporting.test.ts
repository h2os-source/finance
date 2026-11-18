import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "./database";
import {
  createEntry,
  createPlannerItem,
  getFinanceReport,
  importStatementBills,
} from "./finance";

const now = new Date(2026, 10, 19, 12);

function createReportDatabase() {
  return createDatabase(":memory:", { seedSampleData: false });
}

test("a dated income payment appears only in the week containing its transaction date", () => {
  const db = createReportDatabase();
  createEntry(db, {
    kind: "income",
    amountCents: 500000,
    category: "Salary",
    description: "",
    entryDate: "2026-11-19",
  });
  const containingWeek = getFinanceReport(db, { unit: "week", date: "2026-11-19" }, now);
  const followingWeek = getFinanceReport(db, { unit: "week", date: "2026-11-26" }, now);
  assert.equal(containingWeek.incomeCents, 500000);
  assert.equal(followingWeek.incomeCents, 0);
  db.close();
});

test("Spending entries are filtered by their transaction date", () => {
  const db = createReportDatabase();
  createEntry(db, {
    kind: "spending",
    amountCents: 1200,
    category: "Groceries",
    description: "",
    entryDate: "2026-11-22",
  });
  createEntry(db, {
    kind: "spending",
    amountCents: 3400,
    category: "Transport",
    description: "",
    entryDate: "2026-11-23",
  });
  const report = getFinanceReport(db, { unit: "week", date: "2026-11-19" }, now);
  assert.equal(report.spendingCents, 1200);
  db.close();
});

test("Paid Bills are filtered by paid date instead of due date", () => {
  const db = createReportDatabase();
  importStatementBills(db, [
    { name: "Power", provider: "Utility", amountCents: 2100, transactionDate: "2026-11-18", notes: "" },
    { name: "Water", provider: "Utility", amountCents: 3200, transactionDate: "2026-11-23", notes: "" },
  ]);
  const report = getFinanceReport(db, { unit: "week", date: "2026-11-19" }, now);
  assert.equal(report.billsPaidCents, 2100);
  db.close();
});

test("Upcoming Bills stay separate from actual totals and are hidden for past periods", () => {
  const db = createReportDatabase();
  createEntry(db, {
    kind: "income",
    amountCents: 10000,
    category: "Pay",
    description: "",
    entryDate: "2026-11-19",
  });
  createEntry(db, {
    kind: "spending",
    amountCents: 2500,
    category: "Food",
    description: "",
    entryDate: "2026-11-18",
  });
  createPlannerItem(db, {
    kind: "bill",
    name: "Upcoming power",
    provider: "Utility",
    amountCents: 4200,
    dueDate: "2026-11-20",
    recurrence: "none",
    notes: "",
  });
  const currentReport = getFinanceReport(db, { unit: "month", date: "2026-11-19" }, now);
  assert.equal(currentReport.upcomingBillsCents, 4200);
  assert.equal(currentReport.incomeCents, 10000);
  assert.equal(currentReport.spendingCents, 2500);
  assert.equal(currentReport.totalOutgoingsCents, 2500);

  const pastReport = getFinanceReport(db, { unit: "month", date: "2026-10-15" }, now);
  assert.equal(pastReport.upcomingBillsCents, 0);
  assert.deepEqual(pastReport.upcomingItems, []);
  db.close();
});

test("Paid Bills are counted once as separate bill outgoings, not as Spending", () => {
  const db = createReportDatabase();
  createEntry(db, {
    kind: "income",
    amountCents: 30000,
    category: "Pay",
    description: "",
    entryDate: "2026-11-19",
  });
  createEntry(db, {
    kind: "spending",
    amountCents: 5000,
    category: "Bills",
    description: "Manual spending",
    entryDate: "2026-11-19",
  });
  importStatementBills(db, [{
    name: "Water",
    provider: "Utility",
    amountCents: 2500,
    transactionDate: "2026-11-19",
    notes: "",
  }]);
  const report = getFinanceReport(db, { unit: "week", date: "2026-11-19" }, now);
  assert.equal(report.incomeCents, 30000);
  assert.equal(report.spendingCents, 5000);
  assert.equal(report.billsPaidCents, 2500);
  assert.equal(report.totalOutgoingsCents, 7500);
  assert.equal(report.netCashFlowCents, 22500);
  assert.deepEqual(report.categories, [{ category: "Bills", spendingCents: 7500 }]);
  assert.equal(report.series.find((item) => item.bucket === "2026-11-19")?.billsPaidCents, 2500);
  db.close();
});
