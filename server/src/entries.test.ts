import assert from "node:assert/strict";
import { test } from "node:test";
import { createDatabase } from "./database";
import { getDashboardData } from "./dashboard";
import {
  createEntry,
  createPlannerItem,
  deleteAllSpendingEntries,
  getFinanceReport,
  importStatementBills,
  listEntries,
  listPlannerItems,
} from "./finance";

test("delete all Spending removes only spending entries and refreshes spending totals", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const now = new Date("2026-11-19T12:00:00");
  createEntry(db, {
    kind: "spending",
    amountCents: 4100,
    category: "Groceries",
    description: "Manual entry",
    entryDate: "2026-11-05",
  });
  createEntry(db, {
    kind: "spending",
    amountCents: 5900,
    category: "Transport",
    description: "Imported statement transaction",
    entryDate: "2026-11-06",
  });
  createEntry(db, {
    kind: "income",
    amountCents: 65000,
    category: "Salary",
    description: "Pay",
    entryDate: "2026-11-01",
  });
  createPlannerItem(db, {
    kind: "bill",
    name: "Upcoming bill",
    provider: "Utility",
    amountCents: 2500,
    dueDate: "2026-11-25",
    recurrence: "none",
    notes: "",
  });
  importStatementBills(db, [{
    name: "Paid bill",
    provider: "Utility",
    amountCents: 1300,
    transactionDate: "2026-11-03",
    notes: "Statement payment",
  }]);

  assert.equal(getFinanceReport(db, now).spendingCents, 11300);
  assert.equal(getDashboardData(db, now).monthlySpendingCents, 11300);

  assert.equal(deleteAllSpendingEntries(db), 2);

  assert.deepEqual(listEntries(db, "spending"), []);
  assert.equal(listEntries(db, "income").length, 1);
  const bills = listPlannerItems(db, "bill", now);
  assert.equal(bills.length, 2);
  assert.deepEqual(new Set(bills.map((bill) => bill.status)), new Set(["upcoming", "paid"]));
  assert.equal(getFinanceReport(db, now).spendingCents, 1300);
  assert.equal(getDashboardData(db, now).monthlySpendingCents, 1300);
  db.close();
});
