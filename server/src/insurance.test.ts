import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { test } from "node:test";
import { createDatabase } from "./database";
import {
  createPlannerItem,
  deletePlannerItem,
  listPlannerItems,
  updatePlannerItem,
} from "./finance";
import {
  getInsuranceTypeLabel,
  getPolicyRenewalStatus,
  INSURANCE_TYPE_FIELDS,
  INSURANCE_TYPES,
  nextInsurancePaymentDate,
  normalizeInsuranceType,
  sortInsurancePolicies,
} from "./insurance";

function createHomePolicy(db: ReturnType<typeof createDatabase>) {
  return createPlannerItem(db, {
    kind: "insurance",
    name: "Home policy",
    provider: "Cover Co",
    amountCents: 0,
    dueDate: "2026-11-25",
    recurrence: "monthly",
    paymentFrequency: "monthly",
    notes: "",
    policyType: "home",
    propertyName: "12 Smith Street",
    insuredValueCents: 650_000_000,
    contentsCoverCents: 120_000_000,
    policyNumber: "H-123",
    renewalDate: "2027-11-25",
  });
}

test("all eight insurance types and their type-specific fields are defined", () => {
  assert.deepEqual(INSURANCE_TYPES, [
    "home", "car", "health", "pet", "travel", "life", "incomeProtection", "other",
  ]);
  assert.deepEqual(INSURANCE_TYPE_FIELDS, {
    home: ["propertyName", "buildingCover", "contentsCover"],
    car: ["vehicle", "coverBasis", "insuredValue"],
    health: ["policyLevel", "coveredPeople"],
    pet: ["petName", "coverLevel"],
    travel: ["tripDestination", "coverageStartDate", "coverageEndDate"],
    life: ["insuredPerson", "insuredValue"],
    incomeProtection: ["insuredPerson", "monthlyBenefit", "waitingPeriod", "benefitPeriod"],
    other: ["description", "insuredValue"],
  });
});

test("Home property and existing building cover persist with separate renewal dates", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const policy = createHomePolicy(db);
  const [loaded] = listPlannerItems(db, "insurance", new Date("2026-11-19T12:00:00"));

  assert.equal(loaded.propertyName, "12 Smith Street");
  assert.equal(loaded.insuredValueCents, 650_000_000);
  assert.equal(loaded.contentsCoverCents, 120_000_000);
  assert.equal(loaded.policyNumber, "H-123");
  assert.equal(loaded.paymentFrequency, "monthly");
  assert.equal(loaded.nextDueDate, "2026-11-25");
  assert.equal(loaded.renewalDate, "2027-11-25");
  assert.equal(policy.renewalDate, "2027-11-25");
  db.close();
});

test("Insurance register keeps every policy and orders dated renewals before blank dates", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const first = createHomePolicy(db);
  createPlannerItem(db, {
    kind: "insurance",
    name: "Car policy",
    provider: "Auto Cover",
    amountCents: 12_000,
    dueDate: "2020-01-01",
    recurrence: "yearly",
    paymentFrequency: "yearly",
    notes: "",
    policyType: "auto",
    vehicle: "Car",
    insuredValueCents: 2_500_000,
    renewalDate: "2026-12-01",
  });
  createPlannerItem(db, {
    kind: "insurance",
    name: "Old policy",
    provider: "Old Cover",
    amountCents: 8_000,
    dueDate: "2020-01-01",
    recurrence: "monthly",
    notes: "",
    policyType: "life",
    insuredPerson: "Sam",
  });

  const listed = listPlannerItems(db, "insurance", new Date("2026-11-19T12:00:00"));
  const ordered = sortInsurancePolicies(listed);
  assert.equal(ordered.length, 3);
  assert.deepEqual(ordered.map(({ name }) => name), ["Car policy", "Home policy", "Old policy"]);
  assert.equal(ordered.some(({ id }) => id === first.id), true);
  db.close();
});

test("renewal warnings identify overdue and upcoming policies through day 30", () => {
  const now = new Date("2026-11-19T12:00:00");
  assert.equal(getPolicyRenewalStatus("2026-11-18", now), "overdue");
  assert.equal(getPolicyRenewalStatus("2026-11-19", now), "due-soon");
  assert.equal(getPolicyRenewalStatus("2026-12-19", now), "due-soon");
  assert.equal(getPolicyRenewalStatus("2026-12-20", now), null);
  assert.equal(getPolicyRenewalStatus("", now), null);
});

test("half-yearly payment frequency advances independently of renewal date", () => {
  assert.equal(
    nextInsurancePaymentDate("2026-05-31", "half-yearly", new Date("2026-11-20T12:00:00")),
    "2026-11-30",
  );
});

test("legacy policies migrate without losing existing details or recurrence", () => {
  const directory = mkdtempSync(path.join(tmpdir(), "finance-insurance-migration-"));
  const filename = path.join(directory, "legacy.sqlite");
  const legacyDb = new Database(filename);
  legacyDb.exec(`
    CREATE TABLE planner_item (
      id INTEGER PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT '',
      amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
      due_date TEXT NOT NULL,
      recurrence TEXT NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      property_name TEXT NOT NULL DEFAULT 'Home',
      insured_value_cents INTEGER NOT NULL DEFAULT 0,
      policy_type TEXT NOT NULL DEFAULT 'home'
    );
    INSERT INTO planner_item (kind, name, provider, amount_cents, due_date, recurrence, property_name, insured_value_cents)
    VALUES ('insurance', 'Legacy home', 'Old insurer', 25000, '2026-11-20', 'monthly', '8 Old Street', 50000000);
  `);
  legacyDb.close();

  const db = createDatabase(filename, { seedSampleData: false });
  try {
    const [policy] = listPlannerItems(db, "insurance", new Date("2026-11-19T12:00:00"));
    assert.equal(policy.propertyName, "8 Old Street");
    assert.equal(policy.insuredValueCents, 50_000_000);
    assert.equal(policy.paymentFrequency, "monthly");
    assert.equal(policy.renewalDate, "");
    assert.equal(policy.policyNumber, "");
    assert.equal(policy.nextDueDate, "2026-11-20");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("Travel coverage dates are validated only for Travel policies", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const base = {
    kind: "insurance" as const,
    name: "Travel policy",
    provider: "Travel Cover",
    amountCents: 1000,
    dueDate: "2026-11-20",
    recurrence: "none" as const,
    paymentFrequency: "one-off" as const,
    notes: "",
  };
  assert.throws(() => createPlannerItem(db, {
    ...base,
    policyType: "travel",
    coverageStartDate: "2026-12-10",
    coverageEndDate: "2026-12-09",
  }), /Coverage end date cannot be before/);

  const home = createPlannerItem(db, {
    ...base,
    name: "Home policy",
    policyType: "home",
    coverageStartDate: "invalid legacy value",
  });
  assert.equal(home.policyType, "home");
  db.close();
});

test("insurance policies remain editable and deletable, including legacy type aliases", () => {
  const db = createDatabase(":memory:", { seedSampleData: false });
  const policy = createHomePolicy(db);
  const updated = updatePlannerItem(db, policy.id, {
    kind: "insurance",
    name: "Updated home policy",
    provider: "New Cover",
    amountCents: 30_000,
    dueDate: "2026-11-30",
    recurrence: "monthly",
    paymentFrequency: "monthly",
    notes: "Updated",
    policyType: "car",
    vehicle: "Updated vehicle",
    coverBasis: "agreed",
    propertyName: policy.propertyName,
    insuredValueCents: policy.insuredValueCents,
    contentsCoverCents: policy.contentsCoverCents,
    policyNumber: policy.policyNumber,
    renewalDate: policy.renewalDate,
  });
  assert.equal(updated?.name, "Updated home policy");
  assert.equal(updated?.policyType, "car");
  assert.equal(updated?.vehicle, "Updated vehicle");
  assert.equal(updated?.propertyName, "12 Smith Street");
  assert.equal(updated?.insuredValueCents, 650_000_000);
  assert.equal(updated?.contentsCoverCents, 120_000_000);
  assert.equal(deletePlannerItem(db, policy.id), true);
  assert.equal(listPlannerItems(db, "insurance").length, 0);
  assert.equal(normalizeInsuranceType("auto"), "car");
  assert.equal(getInsuranceTypeLabel("income"), "Income Protection");
  db.close();
});
