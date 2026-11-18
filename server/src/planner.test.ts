import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { test } from "node:test";
import { createDatabase } from "./database";
import { getDashboardData } from "./dashboard";
import {
  createPlannerItem,
  deletePlannerItem,
  deletePlannerItemsByStatus,
  getFinanceReport,
  getPlannerUpcoming,
  importStatementBatch,
  importStatementBills,
  listEntries,
  listPlannerItems,
  markPlannerItemPaid,
  updatePlannerItem,
} from "./finance";
import { partitionSelectedStatementRows } from "./statementImportReview";

function createBill(db: ReturnType<typeof createDatabase>, recurrence: "none" | "monthly" = "none") {
  return createPlannerItem(db, {
    kind: "bill",
    name: "Electricity",
    provider: "Power Co",
    amountCents: 15000,
    dueDate: "2026-10-10",
    recurrence,
    notes: "Account 123",
  });
}

test("statement-imported bills are paid on the transaction date and never become upcoming", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const [bill] = importStatementBills(db, [{
    name: "Electricity",
    provider: "Power Co",
    amountCents: 15000,
    transactionDate: "2026-10-03",
    notes: "DIRECT DEBIT ELECTRICITY",
  }]);

  assert.equal(bill.status, "paid");
  assert.equal(bill.paidDate, "2026-10-03");
  assert.equal(bill.dueDate, "2026-10-03");
  assert.equal(bill.recurrence, "none");
  assert.equal(bill.name, "Electricity");
  assert.equal(bill.provider, "Power Co");
  assert.equal(bill.amountCents, 15000);
  assert.equal(bill.notes, "DIRECT DEBIT ELECTRICITY");
  assert.deepEqual(getPlannerUpcoming(db, new Date("2026-10-04T12:00:00")), []);
  assert.deepEqual(listPlannerItems(db, "bill").filter((item) => item.status === "upcoming"), []);
  db.close();
});

test("mixed statement batches import Spending, Income, and valid Bills without importing Ignore or losing other destinations to a bad bill", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const selectedRows = [
    { selected: true, destination: "spending" as const, amountCents: 4200, category: "Groceries", description: "Market", date: "2026-10-01" },
    { selected: true, destination: "income" as const, amountCents: 125000, category: "Income", description: "Salary", date: "2026-10-02" },
    { selected: true, destination: "bill" as const, amountCents: 0, category: "Bills", description: "Invalid bill", date: "2026-10-04" },
    { selected: true, destination: "bill" as const, amountCents: 8000, category: "Bills", description: "Electricity", date: "2026-10-03" },
    { selected: true, destination: "ignore" as const, amountCents: 9900, category: "Transfer", description: "Own account transfer", date: "2026-10-05" },
  ];
  const { entries, bills } = partitionSelectedStatementRows(selectedRows);

  const result = importStatementBatch(
    db,
    entries.map((row) => ({
      kind: row.destination === "income" ? "income" : "spending",
      amountCents: row.amountCents,
      category: row.category,
      description: row.description,
      entryDate: row.date,
    })),
    bills.map((row) => ({
      name: row.description,
      provider: "Statement",
      amountCents: row.amountCents,
      transactionDate: row.date,
      notes: row.description,
    })),
  );

  assert.equal(result.importedSpending, 1);
  assert.equal(result.importedIncome, 1);
  assert.equal(result.importedBills, 1);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].destination, "bill");
  assert.equal(listEntries(db, "spending").length, 1);
  assert.equal(listEntries(db, "income").length, 1);
  const savedBills = listPlannerItems(db, "bill");
  assert.equal(savedBills.length, 1);
  assert.equal(savedBills[0].status, "paid");
  assert.equal(savedBills[0].paidDate, "2026-10-03");
  assert.equal(savedBills.some((item) => item.notes.includes("Own account transfer")), false);
  db.close();
});

test("marking a one-off upcoming bill paid moves it to paid history", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const upcoming = createBill(db);

  const paid = markPlannerItemPaid(db, upcoming.id, "2026-10-10");

  assert.equal(paid?.id, upcoming.id);
  assert.equal(paid?.status, "paid");
  assert.equal(paid?.paidDate, "2026-10-10");
  assert.deepEqual(getPlannerUpcoming(db, new Date("2026-10-10T12:00:00")), []);
  const edited = updatePlannerItem(db, upcoming.id, {
    kind: "bill",
    name: "Updated electricity",
    provider: "Power Co",
    amountCents: upcoming.amountCents,
    dueDate: upcoming.dueDate,
    recurrence: "none",
    notes: upcoming.notes,
  });
  assert.equal(edited?.status, "paid");
  assert.equal(edited?.paidDate, "2026-10-10");
  db.close();
});

test("marking a recurring bill paid records the occurrence and advances its schedule", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const recurring = createPlannerItem(db, {
    kind: "bill",
    name: "Electricity",
    provider: "Power Co",
    amountCents: 15000,
    dueDate: "2026-09-10",
    recurrence: "monthly",
    notes: "Account 123",
  });

  markPlannerItemPaid(db, recurring.id, "2026-10-10");

  const bills = listPlannerItems(db, "bill", new Date("2026-10-10T12:00:00"));
  const paidOccurrence = bills.find((item) => item.status === "paid");
  const upcoming = bills.find((item) => item.id === recurring.id);
  assert.equal(paidOccurrence?.paidDate, "2026-10-10");
  assert.equal(paidOccurrence?.dueDate, "2026-10-10");
  assert.equal(paidOccurrence?.recurrence, "monthly");
  assert.equal(paidOccurrence?.amountCents, recurring.amountCents);
  assert.equal(upcoming?.status, "upcoming");
  assert.equal(upcoming?.dueDate, "2026-11-10");
  assert.equal(upcoming?.recurrence, "monthly");
  assert.equal(upcoming?.nextDueDate, "2026-11-10");
  db.close();
});

test("deleting paid recurring history leaves the next upcoming occurrence intact", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const recurring = createBill(db, "monthly");
  markPlannerItemPaid(db, recurring.id, "2026-10-10");
  const history = listPlannerItems(db, "bill").find((item) => item.status === "paid");
  assert.ok(history);

  assert.equal(deletePlannerItem(db, history.id), true);
  const upcoming = listPlannerItems(db, "bill").find((item) => item.id === recurring.id);
  assert.equal(upcoming?.status, "upcoming");
  assert.equal(upcoming?.dueDate, "2026-11-10");
  db.close();
});

test("bulk deleting Upcoming bills leaves all Paid history intact", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const recurring = createBill(db, "monthly");
  markPlannerItemPaid(db, recurring.id, "2026-10-10");
  importStatementBills(db, [{
    name: "Water",
    provider: "Water Co",
    amountCents: 5000,
    transactionDate: "2026-10-11",
    notes: "Statement payment",
  }]);

  assert.equal(deletePlannerItemsByStatus(db, "upcoming"), 1);
  const remaining = listPlannerItems(db, "bill");
  assert.equal(remaining.some((item) => item.status === "upcoming"), false);
  assert.equal(remaining.filter((item) => item.status === "paid").length, 2);
  db.close();
});

test("bulk deleting Paid bills leaves Upcoming bills intact", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const upcoming = createBill(db, "monthly");
  markPlannerItemPaid(db, upcoming.id, "2026-10-10");
  importStatementBills(db, [{
    name: "Water",
    provider: "Water Co",
    amountCents: 5000,
    transactionDate: "2026-10-11",
    notes: "Statement payment",
  }]);
  const separateUpcoming = createBill(db);

  assert.equal(deletePlannerItemsByStatus(db, "paid"), 2);
  const remaining = listPlannerItems(db, "bill");
  assert.deepEqual(remaining.map((item) => item.id).sort((left, right) => left - right), [upcoming.id, separateUpcoming.id].sort((left, right) => left - right));
  assert.equal(remaining.every((item) => item.status === "upcoming"), true);
  db.close();
});

test("paid bills contribute to historical spending but not upcoming totals", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  importStatementBills(db, [{
    name: "Electricity",
    provider: "Power Co",
    amountCents: 15000,
    transactionDate: "2026-10-03",
    notes: "Statement payment",
  }]);

  const report = getFinanceReport(db, new Date("2026-10-15T12:00:00"));
  const october = report.series.find((item) => item.bucket === "2026-10-03");
  assert.equal(october?.billsPaidCents, 15000);
  assert.equal(report.spendingCents, 0);
  assert.equal(report.billsPaidCents, 15000);
  const dashboard = getDashboardData(db, new Date("2026-10-15T12:00:00"));
  assert.equal(dashboard.monthlySpendingCents, 15000);
  assert.equal(dashboard.spendingHistory.find((item) => item.month === "2026-10")?.spendingCents, 15000);
  assert.equal(getPlannerUpcoming(db, new Date("2026-10-15T12:00:00")).length, 0);
  db.close();
});

test("legacy bills without status migrate to upcoming", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "finance-bill-migration-"));
  const filename = path.join(directory, "legacy.sqlite");
  const legacyDb = new Database(filename);
  legacyDb.exec(`
    CREATE TABLE planner_item (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL,
      due_date TEXT NOT NULL,
      recurrence TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      property_name TEXT NOT NULL DEFAULT 'Home',
      insured_value_cents INTEGER NOT NULL DEFAULT 0,
      policy_type TEXT NOT NULL DEFAULT 'home'
    );
    INSERT INTO planner_item (kind, name, amount_cents, due_date, recurrence)
    VALUES ('bill', 'Old bill', 2500, '2026-11-01', 'none');
  `);
  legacyDb.close();

  const db = createDatabase(filename, { seedSampleData: false });
  try {
    const [bill] = listPlannerItems(db, "bill", new Date("2026-10-10T12:00:00"));
    assert.equal(bill.status, "upcoming");
    assert.equal(bill.paidDate, null);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
