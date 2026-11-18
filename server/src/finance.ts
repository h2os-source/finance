import type Database from "better-sqlite3";
import {
  INSURANCE_TYPE_FIELDS,
  normalizeInsuranceType,
  nextInsurancePaymentDate,
  validateTravelCoverageDates,
  type InsuranceDetailField,
  type InsurancePaymentFrequency,
  type InsurancePolicyType,
} from "./insurance";
import {
  getPeriodRange,
  isDateInPeriod,
  isPeriodCurrentOrFuture,
  localDateString,
  type PeriodSelection,
  type PeriodUnit,
} from "./timePeriods";
import { isBudgetGroup, monthlyEquivalentCents, type BudgetGroup } from "./budget";

export type EntryKind = "income" | "spending";
export type PlannerKind = "bill" | "insurance";
export type PlannerStatus = "upcoming" | "paid";
export type Recurrence = "none" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export interface FinanceEntry {
  id: number;
  kind: EntryKind;
  amountCents: number;
  category: string;
  description: string;
  entryDate: string;
}

export interface FinanceEntryInput {
  kind: EntryKind;
  amountCents: number;
  category: string;
  description: string;
  entryDate: string;
}

export type IncomeRecurrence = Exclude<Recurrence, "none">;

export interface RecurringIncome {
  id: number;
  amountCents: number;
  category: string;
  description: string;
  nextDate: string;
  recurrence: IncomeRecurrence;
}

export type RecurringIncomeInput = Omit<RecurringIncome, "id">;

export interface BudgetPlan {
  id: number;
  category: string;
  group: BudgetGroup;
  limitCents: number;
  spentCents: number;
  frequency: BudgetFrequency;
  sourceType: BudgetSourceType;
  sourceId: number | null;
  committedCents: number;
}

export type BudgetSourceType = "mortgage" | "loan" | "bill" | "insurance" | "other";
export type BudgetFrequency = "weekly" | "fortnightly" | "monthly";

export interface BudgetInput {
  category: string;
  group?: BudgetGroup;
  limitCents: number;
  frequency?: BudgetFrequency;
  sourceType?: BudgetSourceType;
  sourceId?: number | null;
}

export interface BudgetBuilderSummary {
  incomeCents: number;
  fixedCommitmentsCents: number;
  month: string;
}

export interface PlannerItem {
  id: number;
  kind: PlannerKind;
  status: PlannerStatus;
  paidDate: string | null;
  name: string;
  provider: string;
  amountCents: number;
  dueDate: string;
  recurrence: Recurrence;
  notes: string;
  propertyName: string;
  insuredValueCents: number;
  policyType: PolicyType;
  policyNumber: string;
  paymentFrequency: InsurancePaymentFrequency | "";
  renewalDate: string;
  contentsCoverCents: number;
  vehicle: string;
  coverBasis: string;
  policyLevel: string;
  coveredPeople: string;
  petName: string;
  coverLevel: string;
  tripDestination: string;
  coverageStartDate: string;
  coverageEndDate: string;
  insuredPerson: string;
  waitingPeriod: string;
  benefitPeriod: string;
  otherDescription: string;
  nextDueDate: string;
}

export type PolicyType = InsurancePolicyType;

export type PlannerItemInput = Omit<
  PlannerItem,
  "id" | "nextDueDate" | "status" | "paidDate" | "propertyName" | "insuredValueCents" | "policyType" |
  "policyNumber" | "paymentFrequency" | "renewalDate" | "contentsCoverCents" | "vehicle" | "coverBasis" |
  "policyLevel" | "coveredPeople" | "petName" | "coverLevel" | "tripDestination" | "coverageStartDate" |
  "coverageEndDate" | "insuredPerson" | "waitingPeriod" | "benefitPeriod" | "otherDescription"
> & {
  policyType?: PolicyType;
  propertyName?: string;
  insuredValueCents?: number;
  policyNumber?: string;
  paymentFrequency?: InsurancePaymentFrequency;
  renewalDate?: string;
  contentsCoverCents?: number;
  vehicle?: string;
  coverBasis?: string;
  policyLevel?: string;
  coveredPeople?: string;
  petName?: string;
  coverLevel?: string;
  tripDestination?: string;
  coverageStartDate?: string;
  coverageEndDate?: string;
  insuredPerson?: string;
  waitingPeriod?: string;
  benefitPeriod?: string;
  otherDescription?: string;
};

export interface StatementBillInput {
  name: string;
  provider: string;
  amountCents: number;
  transactionDate: string;
  notes: string;
}

export interface StatementImportFailure {
  destination: EntryKind | "bill";
  index: number;
  message: string;
}

export interface StatementImportResult {
  imported: number;
  importedIncome: number;
  importedSpending: number;
  importedBills: number;
  failures: StatementImportFailure[];
}

export interface FinanceReport {
  period: PeriodUnit;
  startDate: string;
  endDate: string;
  hasActivity: boolean;
  series: Array<{ bucket: string; incomeCents: number; spendingCents: number; billsPaidCents: number }>;
  categories: Array<{ category: string; spendingCents: number }>;
  incomeCents: number;
  spendingCents: number;
  billsPaidCents: number;
  totalOutgoingsCents: number;
  netCashFlowCents: number;
  upcomingBillsCents: number;
  upcomingItems: Array<{ id: number; title: string; dueDate: string; amountCents: number; kind: "bill" | "renewal" }>;
}

export function listRecurringIncome(db: Database.Database, now = new Date()): RecurringIncome[] {
  const schedules = db.prepare(
    `SELECT id, amount_cents AS amountCents, category, description, next_date AS nextDate, recurrence
     FROM recurring_income ORDER BY next_date, category COLLATE NOCASE`,
  ).all() as RecurringIncome[];
  return schedules.map((schedule) => ({
    ...schedule,
    nextDate: nextOccurrence(schedule.nextDate, schedule.recurrence, now),
  }));
}

export function createRecurringIncome(db: Database.Database, input: RecurringIncomeInput): RecurringIncome {
  validateRecurringIncome(input);
  const result = db.prepare(
    `INSERT INTO recurring_income (amount_cents, category, description, next_date, recurrence)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.amountCents, input.category.trim(), input.description.trim(), input.nextDate, input.recurrence);
  return {
    id: Number(result.lastInsertRowid),
    ...input,
    category: input.category.trim(),
    description: input.description.trim(),
  };
}

export function updateRecurringIncome(
  db: Database.Database,
  id: number,
  input: RecurringIncomeInput,
): RecurringIncome | null {
  validateRecurringIncome(input);
  const result = db.prepare(
    `UPDATE recurring_income
     SET amount_cents = ?, category = ?, description = ?, next_date = ?, recurrence = ?
     WHERE id = ?`,
  ).run(input.amountCents, input.category.trim(), input.description.trim(), input.nextDate, input.recurrence, id);
  if (!result.changes) return null;
  return {
    id,
    ...input,
    category: input.category.trim(),
    description: input.description.trim(),
  };
}

export function deleteRecurringIncome(db: Database.Database, id: number): boolean {
  return db.prepare("DELETE FROM recurring_income WHERE id = ?").run(id).changes > 0;
}

function validateRecurringIncome(input: RecurringIncomeInput): void {
  validateAmount(input.amountCents, "income amount");
  if (typeof input.category !== "string" || !input.category.trim() || input.category.trim().length > 80) {
    throw new Error("Enter an income source or category of up to 80 characters.");
  }
  if (typeof input.description !== "string" || input.description.length > 200) {
    throw new Error("Notes must be 200 characters or fewer.");
  }
  validateDate(input.nextDate, "next payment");
  if (!["weekly", "fortnightly", "monthly", "quarterly", "yearly"].includes(input.recurrence)) {
    throw new Error("Choose a valid recurring income frequency.");
  }
}

function occurrenceAt(anchorValue: string, recurrence: IncomeRecurrence, index: number): Date {
  const anchor = new Date(`${anchorValue}T12:00:00`);
  if (recurrence === "weekly" || recurrence === "fortnightly") {
    anchor.setDate(anchor.getDate() + index * (recurrence === "weekly" ? 7 : 14));
    return anchor;
  }
  const step = recurrence === "monthly" ? 1 : recurrence === "quarterly" ? 3 : 12;
  const monthIndex = anchor.getMonth() + step * index;
  const year = anchor.getFullYear() + Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  const day = Math.min(anchor.getDate(), new Date(year, month + 1, 0).getDate());
  return new Date(year, month, day, 12);
}

function asDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function nextOccurrence(anchor: string, recurrence: IncomeRecurrence, now: Date): string {
  let index = 0;
  while (occurrenceAt(anchor, recurrence, index) < now) index++;
  return asDateString(occurrenceAt(anchor, recurrence, index));
}

function recurringIncomeByMonth(
  db: Database.Database,
  months: string[],
): Map<string, number> {
  const totals = new Map(months.map((month) => [month, 0]));
  for (const occurrence of recurringIncomeOccurrencesByMonth(db, months)) {
    totals.set(occurrence.month, (totals.get(occurrence.month) ?? 0) + occurrence.amountCents);
  }
  return totals;
}

function recurringIncomeOccurrencesByMonth(
  db: Database.Database,
  months: string[],
): Array<{ month: string; category: string; amountCents: number }> {
  if (!months.length) return [];
  const schedules = db.prepare(
    "SELECT amount_cents AS amountCents, category, next_date AS nextDate, recurrence FROM recurring_income",
  ).all() as Array<Pick<RecurringIncome, "amountCents" | "category" | "nextDate" | "recurrence">>;
  const firstMonth = months[0];
  const lastMonth = months[months.length - 1];
  const rangeStart = new Date(`${firstMonth}-01T00:00:00`);
  const rangeEnd = new Date(`${lastMonth}-01T00:00:00`);
  rangeEnd.setMonth(rangeEnd.getMonth() + 1);
  const occurrences: Array<{ month: string; category: string; amountCents: number }> = [];

  for (const schedule of schedules) {
    let index = 0;
    let occurrence = occurrenceAt(schedule.nextDate, schedule.recurrence, index);
    while (occurrence < rangeStart) {
      index++;
      occurrence = occurrenceAt(schedule.nextDate, schedule.recurrence, index);
    }
    while (occurrence < rangeEnd) {
      occurrences.push({
        month: asDateString(occurrence).slice(0, 7),
        category: schedule.category,
        amountCents: schedule.amountCents,
      });
      index++;
      occurrence = occurrenceAt(schedule.nextDate, schedule.recurrence, index);
    }
  }
  return occurrences;
}

export function recurringIncomeForMonth(db: Database.Database, month: string): number {
  return recurringIncomeByMonth(db, [month]).get(month) ?? 0;
}

function validateDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`Enter a valid ${label} date.`);
  }
}

function validateAmount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 100_000_000_000) {
    throw new Error(`Enter a ${label} greater than $0 and no more than $1 billion.`);
  }
}

export function listEntries(db: Database.Database, kind: EntryKind): FinanceEntry[] {
  return db.prepare(
    `SELECT id, kind, amount_cents AS amountCents, category, description, entry_date AS entryDate
     FROM finance_entry WHERE kind = ? ORDER BY entry_date DESC, id DESC`,
  ).all(kind) as FinanceEntry[];
}

export function createEntry(db: Database.Database, input: FinanceEntryInput): FinanceEntry {
  validateEntry(input);
  const result = db.prepare(
    `INSERT INTO finance_entry (kind, amount_cents, category, description, entry_date)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(input.kind, input.amountCents, input.category.trim(), input.description.trim(), input.entryDate);
  return db.prepare(
    `SELECT id, kind, amount_cents AS amountCents, category, description, entry_date AS entryDate
     FROM finance_entry WHERE id = ?`,
  ).get(result.lastInsertRowid) as FinanceEntry;
}

export function updateEntry(db: Database.Database, id: number, input: FinanceEntryInput): FinanceEntry | null {
  validateEntry(input);
  const result = db.prepare(
    `UPDATE finance_entry SET kind = ?, amount_cents = ?, category = ?, description = ?, entry_date = ?
     WHERE id = ?`,
  ).run(input.kind, input.amountCents, input.category.trim(), input.description.trim(), input.entryDate, id);
  if (!result.changes) return null;
  return db.prepare(
    `SELECT id, kind, amount_cents AS amountCents, category, description, entry_date AS entryDate
     FROM finance_entry WHERE id = ?`,
  ).get(id) as FinanceEntry;
}

export function deleteEntry(db: Database.Database, id: number): boolean {
  return db.prepare("DELETE FROM finance_entry WHERE id = ?").run(id).changes > 0;
}

export function deleteAllSpendingEntries(db: Database.Database): number {
  return db.prepare("DELETE FROM finance_entry WHERE kind = 'spending'").run().changes;
}

export function importEntries(db: Database.Database, inputs: FinanceEntryInput[]): number {
  if (inputs.length === 0) throw new Error("Choose at least one transaction to import.");
  if (inputs.length > 2000) throw new Error("Import up to 2,000 transactions at a time.");
  const run = db.transaction(() => inputs.forEach((input) => createEntry(db, input)));
  run();
  return inputs.length;
}

function validateEntry(input: FinanceEntryInput): void {
  if (input.kind !== "income" && input.kind !== "spending") throw new Error("Choose income or spending.");
  validateAmount(input.amountCents, "amount");
  if (typeof input.category !== "string" || !input.category.trim() || input.category.trim().length > 80) {
    throw new Error("Enter a category of up to 80 characters.");
  }
  if (typeof input.description !== "string" || input.description.length > 200) {
    throw new Error("Notes must be 200 characters or fewer.");
  }
  validateDate(input.entryDate, "entry");
}

export function listBudgets(db: Database.Database, period: string | Date = new Date()): BudgetPlan[] {
  const referenceDate = typeof period === "string"
    ? new Date(`${period.slice(0, 7)}-01T12:00:00.000Z`)
    : period;
  const budgets = db.prepare(
    `SELECT b.id, b.category, b.group_name AS "group", b.limit_cents AS limitCents, b.frequency,
            b.source_type AS sourceType, b.source_id AS sourceId
     FROM budget_plan b
     ORDER BY b.category COLLATE NOCASE`,
  ).all() as Array<Omit<BudgetPlan, "spentCents" | "committedCents">>;
  return budgets.map((budget) => {
    const { start, end } = getBudgetPeriod(referenceDate, budget.frequency);
    const spentCents = (db.prepare(
      `SELECT COALESCE(SUM(amount_cents), 0) AS spentCents FROM finance_entry
       WHERE kind = 'spending' AND lower(category) = lower(?) AND entry_date >= ? AND entry_date < ?`,
    ).get(budget.category, start, end) as { spentCents: number }).spentCents;
    const sourceCost = getBudgetSourcePeriodCost(db, budget.sourceType, budget.sourceId, budget.frequency, start, end);
    return {
      ...budget,
      spentCents,
      committedCents: Math.max(0, sourceCost - (budget.sourceType === "other" ? 0 : spentCents)),
    };
  });
}

export function saveBudgets(db: Database.Database, budgets: BudgetInput[]): BudgetPlan[] {
  if (budgets.length > 100) throw new Error("You can save up to 100 budget categories.");
  const seen = new Set<string>();
  const seenSources = new Set<string>();
  for (const budget of budgets) {
    if (typeof budget.category !== "string" || !budget.category.trim() || budget.category.trim().length > 80) {
      throw new Error("Enter a budget category of up to 80 characters.");
    }
    const group = budget.group ?? "Other";
    if (!isBudgetGroup(group)) throw new Error("Choose a valid budget group.");
    const key = budget.category.trim().toLocaleLowerCase();
    if (seen.has(key)) throw new Error("Budget categories must be unique.");
    seen.add(key);
    const sourceType = budget.sourceType ?? "other";
    const sourceId = budget.sourceId ?? null;
    const frequency = budget.frequency ?? "monthly";
    if (!( ["weekly", "fortnightly", "monthly"] as string[]).includes(frequency)) {
      throw new Error("Choose a weekly, fortnightly, or monthly budget period.");
    }
    if (!( ["mortgage", "loan", "bill", "insurance", "other"] as string[]).includes(sourceType)) {
      throw new Error("Choose a valid budget type.");
    }
    if (sourceType === "other") {
      if (sourceId !== null) throw new Error("Other budget categories cannot be linked to a source item.");
    } else {
      if (!Number.isSafeInteger(sourceId) || (sourceId as number) <= 0) {
        throw new Error("Choose an item to include in this budget.");
      }
      const sourceExists = sourceType === "mortgage"
        ? db.prepare("SELECT 1 AS found FROM mortgage WHERE id = ? AND is_mock = 0").get(sourceId)
        : sourceType === "loan"
          ? db.prepare("SELECT 1 AS found FROM personal_loan WHERE id = ?").get(sourceId)
          : db.prepare("SELECT 1 AS found FROM planner_item WHERE id = ? AND kind = ?").get(sourceId, sourceType);
      if (!sourceExists) throw new Error("That budget source was not found. Reload and choose another item.");
      const sourceKey = `${sourceType}:${sourceId}`;
      if (seenSources.has(sourceKey)) throw new Error("Each source item can only be included once.");
      seenSources.add(sourceKey);
    }
    validateAmount(budget.limitCents, "monthly budget");
  }
  const save = db.transaction(() => {
    db.prepare("DELETE FROM budget_plan").run();
    const insert = db.prepare("INSERT INTO budget_plan (category, group_name, limit_cents, frequency, source_type, source_id) VALUES (?, ?, ?, ?, ?, ?)");
    budgets.forEach(({ category, group = "Other", limitCents, frequency = "monthly", sourceType = "other", sourceId = null }) =>
      insert.run(category.trim(), group, limitCents, frequency, sourceType, sourceId));
  });
  save();
  return listBudgets(db, new Date());
}

export function getBudgetBuilderSummary(db: Database.Database, now = new Date()): BudgetBuilderSummary {
  const start = localDateString(new Date(now.getFullYear(), now.getMonth(), 1));
  const end = localDateString(new Date(now.getFullYear(), now.getMonth() + 1, 1));
  const actualIncome = db.prepare(
    `SELECT amount_cents AS amountCents, category FROM finance_entry
     WHERE kind = 'income' AND entry_date >= ? AND entry_date < ?`,
  ).all(start, end) as Array<{ amountCents: number; category: string }>;
  const recordedByCategory = new Map<string, number>();
  const actualIncomeCents = actualIncome.reduce((total, entry) => {
    const category = entry.category.trim().toLocaleLowerCase();
    recordedByCategory.set(category, (recordedByCategory.get(category) ?? 0) + 1);
    return total + entry.amountCents;
  }, 0);
  const scheduledIncomeCents = recurringIncomeOccurrencesByMonth(db, [start.slice(0, 7)])
    .reduce((total, occurrence) => {
      const category = occurrence.category.trim().toLocaleLowerCase();
      const recordedCount = recordedByCategory.get(category) ?? 0;
      if (recordedCount > 0) {
        // A recorded payment replaces one projected occurrence in the same income category.
        recordedByCategory.set(category, recordedCount - 1);
        return total;
      }
      return total + occurrence.amountCents;
    }, 0);

  const mortgageCents = (db.prepare(
    `SELECT repayment_cents AS amountCents, repayment_frequency AS frequency
     FROM mortgage WHERE is_mock = 0 AND repayment_cents > 0`,
  ).all() as Array<{ amountCents: number; frequency: BudgetFrequency }>)
    .reduce((total, item) => total + monthlyEquivalentCents(item.amountCents, item.frequency), 0);
  const loanCents = (db.prepare(
    `SELECT repayment_cents AS amountCents, repayment_frequency AS frequency
     FROM personal_loan WHERE repayment_cents > 0`,
  ).all() as Array<{ amountCents: number; frequency: BudgetFrequency }>)
    .reduce((total, item) => total + monthlyEquivalentCents(item.amountCents, item.frequency), 0);

  const bills = db.prepare(
    `SELECT amount_cents AS amountCents, due_date AS dueDate, recurrence
     FROM planner_item WHERE kind = 'bill' AND status = 'upcoming'`,
  ).all() as Array<{ amountCents: number; dueDate: string; recurrence: Recurrence }>;
  const billCents = bills.reduce((total, bill) => {
    if (bill.recurrence === "none") {
      return total + (bill.dueDate >= start && bill.dueDate < end ? bill.amountCents : 0);
    }
    return total + monthlyRecurringAmount(bill.amountCents, bill.recurrence);
  }, 0);

  const insurance = db.prepare(
    `SELECT amount_cents AS amountCents, recurrence, payment_frequency AS paymentFrequency
     FROM planner_item WHERE kind = 'insurance' AND status = 'upcoming'`,
  ).all() as Array<{ amountCents: number; recurrence: Recurrence; paymentFrequency: string }>;
  const insuranceCents = insurance.reduce((total, policy) => {
    const frequency = policy.paymentFrequency || (policy.recurrence === "none" ? "one-off" : policy.recurrence);
    return total + (frequency === "one-off" ? 0 : monthlyRecurringAmount(policy.amountCents, frequency));
  }, 0);

  return {
    incomeCents: actualIncomeCents + scheduledIncomeCents,
    fixedCommitmentsCents: mortgageCents + loanCents + billCents + insuranceCents,
    month: start.slice(0, 7),
  };
}

function monthlyRecurringAmount(amountCents: number, frequency: string): number {
  const periodsPerYear: Record<string, number> = {
    weekly: 52,
    fortnightly: 26,
    monthly: 12,
    quarterly: 4,
    "half-yearly": 2,
    yearly: 1,
  };
  const periods = periodsPerYear[frequency];
  return periods ? Math.round(amountCents * periods / 12) : 0;
}

function getBudgetSourcePeriodCost(
  db: Database.Database,
  sourceType: BudgetSourceType,
  sourceId: number | null,
  frequency: BudgetFrequency,
  start: string,
  end: string,
): number {
  if (!sourceId || sourceType === "other") return 0;
  if (sourceType === "mortgage" || sourceType === "loan") {
    const table = sourceType === "mortgage" ? "mortgage" : "personal_loan";
    const row = db.prepare(
      `SELECT repayment_cents AS amountCents, repayment_frequency AS frequency
       FROM ${table} WHERE id = ? ${sourceType === "mortgage" ? "AND is_mock = 0" : ""}`,
    ).get(sourceId) as { amountCents: number | null; frequency: string } | undefined;
    if (!row?.amountCents) return 0;
    return convertRecurringCost(row.amountCents, row.frequency as BudgetFrequency, frequency);
  }

  const row = db.prepare(
    `SELECT amount_cents AS amountCents, due_date AS dueDate, recurrence, status, payment_frequency AS paymentFrequency
     FROM planner_item WHERE id = ? AND kind = ?`,
  ).get(sourceId, sourceType) as {
    amountCents: number;
    dueDate: string;
    recurrence: Recurrence;
    status: PlannerStatus;
    paymentFrequency: InsurancePaymentFrequency | "";
  } | undefined;
  if (!row) return 0;
  if (sourceType === "bill" && row.status !== "upcoming") return 0;
  const recurrence = sourceType === "insurance"
    ? row.paymentFrequency || (row.recurrence === "none" ? "one-off" : row.recurrence)
    : row.recurrence;
  if (recurrence === "none" || recurrence === "one-off") {
    return row.dueDate >= start && row.dueDate < end ? row.amountCents : 0;
  }
  const periodsPerYear: Record<Exclude<InsurancePaymentFrequency, "one-off">, number> = {
    weekly: 52,
    fortnightly: 26,
    monthly: 12,
    quarterly: 4,
    "half-yearly": 2,
    yearly: 1,
  };
  return Math.round(row.amountCents * periodsPerYear[recurrence] / budgetPeriodsPerYear(frequency));
}

function convertRecurringCost(amountCents: number, sourceFrequency: BudgetFrequency, budgetFrequency: BudgetFrequency): number {
  return Math.round(amountCents * budgetPeriodsPerYear(sourceFrequency) / budgetPeriodsPerYear(budgetFrequency));
}

function budgetPeriodsPerYear(frequency: BudgetFrequency): number {
  return frequency === "weekly" ? 52 : frequency === "fortnightly" ? 26 : 12;
}

function getBudgetPeriod(date: Date, frequency: BudgetFrequency): { start: string; end: string } {
  const startDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  if (frequency === "monthly") {
    startDate.setUTCDate(1);
  } else {
    const mondayOffset = (startDate.getUTCDay() + 6) % 7;
    startDate.setUTCDate(startDate.getUTCDate() - mondayOffset);
    if (frequency === "fortnightly") {
      const anchor = Date.UTC(1970, 0, 5);
      const elapsedWeeks = Math.floor((startDate.getTime() - anchor) / (7 * 24 * 60 * 60 * 1000));
      if (elapsedWeeks % 2 !== 0) startDate.setUTCDate(startDate.getUTCDate() - 7);
    }
  }
  const endDate = new Date(startDate);
  if (frequency === "weekly") endDate.setUTCDate(endDate.getUTCDate() + 7);
  else if (frequency === "fortnightly") endDate.setUTCDate(endDate.getUTCDate() + 14);
  else endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  return { start: startDate.toISOString().slice(0, 10), end: endDate.toISOString().slice(0, 10) };
}

export function listPlannerItems(
  db: Database.Database,
  kind: PlannerKind,
  now = new Date(),
): PlannerItem[] {
  return (db.prepare(
        `SELECT id, kind, status, paid_date AS paidDate, name, provider, amount_cents AS amountCents, due_date AS dueDate,
          recurrence, notes, property_name AS propertyName, insured_value_cents AS insuredValueCents, policy_type AS policyType,
          policy_number AS policyNumber, payment_frequency AS paymentFrequency, renewal_date AS renewalDate,
          contents_cover_cents AS contentsCoverCents, vehicle, cover_basis AS coverBasis, policy_level AS policyLevel,
          covered_people AS coveredPeople, pet_name AS petName, cover_level AS coverLevel,
          trip_destination AS tripDestination, coverage_start_date AS coverageStartDate,
          coverage_end_date AS coverageEndDate, insured_person AS insuredPerson, waiting_period AS waitingPeriod,
          benefit_period AS benefitPeriod, other_description AS otherDescription
     FROM planner_item WHERE kind = ? ORDER BY due_date, name COLLATE NOCASE`,
  ).all(kind) as Omit<PlannerItem, "nextDueDate">[]).map((item) => {
    const nextDate = item.kind === "insurance"
    ? nextInsurancePaymentDate(
      item.dueDate,
      item.paymentFrequency || (item.recurrence === "none" ? "one-off" : item.recurrence),
      now,
    )
      : nextDueDate(item.dueDate, item.recurrence, now);
    return {
      ...item,
      nextDueDate: item.status === "paid" ? item.paidDate ?? item.dueDate : nextDate,
    };
  });
}

export function createPlannerItem(
  db: Database.Database,
  input: PlannerItemInput,
  status: PlannerStatus = "upcoming",
  paidDate: string | null = null,
): PlannerItem {
  validatePlannerItem(input);
  validatePlannerStatus(input.kind, status, paidDate);
  const result = db.prepare(
    `INSERT INTO planner_item (
       kind, status, paid_date, name, provider, amount_cents, due_date, recurrence, notes, property_name,
       insured_value_cents, policy_type, policy_number, payment_frequency, renewal_date, contents_cover_cents,
       vehicle, cover_basis, policy_level, covered_people, pet_name, cover_level, trip_destination,
       coverage_start_date, coverage_end_date, insured_person, waiting_period, benefit_period, other_description
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.kind, status, paidDate, input.name.trim(), input.provider.trim(), input.amountCents, input.dueDate,
    input.recurrence, input.notes.trim(), input.propertyName?.trim() || "Home", input.insuredValueCents ?? 0,
    input.policyType ?? "home", input.policyNumber?.trim() ?? "",
    input.paymentFrequency ?? (input.recurrence === "none" ? "one-off" : input.recurrence),
    input.renewalDate ?? "", input.contentsCoverCents ?? 0, input.vehicle?.trim() ?? "",
    input.coverBasis?.trim() ?? "", input.policyLevel?.trim() ?? "", input.coveredPeople?.trim() ?? "",
    input.petName?.trim() ?? "", input.coverLevel?.trim() ?? "", input.tripDestination?.trim() ?? "",
    input.coverageStartDate ?? "", input.coverageEndDate ?? "", input.insuredPerson?.trim() ?? "",
    input.waitingPeriod?.trim() ?? "", input.benefitPeriod?.trim() ?? "", input.otherDescription?.trim() ?? "",
  );
  return getPlannerItem(db, Number(result.lastInsertRowid));
}

export function updatePlannerItem(db: Database.Database, id: number, input: PlannerItemInput): PlannerItem | null {
  validatePlannerItem(input);
  const result = db.prepare(
    `UPDATE planner_item SET kind = ?, name = ?, provider = ?, amount_cents = ?, due_date = ?, recurrence = ?, notes = ?,
      property_name = ?, insured_value_cents = ?, policy_type = ?, policy_number = ?, payment_frequency = ?,
      renewal_date = ?, contents_cover_cents = ?, vehicle = ?, cover_basis = ?, policy_level = ?, covered_people = ?,
      pet_name = ?, cover_level = ?, trip_destination = ?, coverage_start_date = ?, coverage_end_date = ?,
      insured_person = ?, waiting_period = ?, benefit_period = ?, other_description = ?
     WHERE id = ?`,
  ).run(
    input.kind, input.name.trim(), input.provider.trim(), input.amountCents, input.dueDate, input.recurrence,
    input.notes.trim(), input.propertyName?.trim() || "Home", input.insuredValueCents ?? 0, input.policyType ?? "home",
    input.policyNumber?.trim() ?? "",
    input.paymentFrequency ?? (input.recurrence === "none" ? "one-off" : input.recurrence),
    input.renewalDate ?? "",
    input.contentsCoverCents ?? 0, input.vehicle?.trim() ?? "", input.coverBasis?.trim() ?? "",
    input.policyLevel?.trim() ?? "", input.coveredPeople?.trim() ?? "", input.petName?.trim() ?? "",
    input.coverLevel?.trim() ?? "", input.tripDestination?.trim() ?? "", input.coverageStartDate ?? "",
    input.coverageEndDate ?? "", input.insuredPerson?.trim() ?? "", input.waitingPeriod?.trim() ?? "",
    input.benefitPeriod?.trim() ?? "", input.otherDescription?.trim() ?? "", id,
  );
  if (!result.changes) return null;
  return getPlannerItem(db, id);
}

export function deletePlannerItem(db: Database.Database, id: number): boolean {
  return db.prepare("DELETE FROM planner_item WHERE id = ?").run(id).changes > 0;
}

export function deletePlannerItemsByStatus(db: Database.Database, status: PlannerStatus): number {
  return db.prepare("DELETE FROM planner_item WHERE kind = 'bill' AND status = ?").run(status).changes;
}

export function importStatementBills(db: Database.Database, inputs: StatementBillInput[]): PlannerItem[] {
  if (inputs.length > 2000) throw new Error("Import up to 2,000 transactions at a time.");
  const importAll = db.transaction(() => inputs.map((input) => createPlannerItem(db, {
    kind: "bill",
    name: input.name,
    provider: input.provider,
    amountCents: input.amountCents,
    dueDate: input.transactionDate,
    recurrence: "none",
    notes: input.notes,
  }, "paid", input.transactionDate)));
  return importAll();
}

export function importStatementBatch(
  db: Database.Database,
  entries: FinanceEntryInput[],
  bills: StatementBillInput[],
): StatementImportResult {
  const result: StatementImportResult = {
    imported: 0,
    importedIncome: 0,
    importedSpending: 0,
    importedBills: 0,
    failures: [],
  };

  if (entries.length > 2000) {
    result.failures.push({ destination: "spending", index: -1, message: "Import up to 2,000 transactions at a time." });
  } else {
    entries.forEach((entry, index) => {
      try {
        createEntry(db, entry);
        result.imported++;
        if (entry.kind === "income") result.importedIncome++;
        else result.importedSpending++;
      } catch (error) {
        result.failures.push({
          destination: entry.kind === "income" ? "income" : "spending",
          index,
          message: error instanceof Error ? error.message : "This transaction could not be imported.",
        });
      }
    });
  }

  if (bills.length > 2000) {
    result.failures.push({ destination: "bill", index: -1, message: "Import up to 2,000 transactions at a time." });
  } else {
    bills.forEach((bill, index) => {
      try {
        importStatementBills(db, [bill]);
        result.importedBills++;
      } catch (error) {
        result.failures.push({
          destination: "bill",
          index,
          message: error instanceof Error ? error.message : "This bill transaction could not be imported.",
        });
      }
    });
  }
  return result;
}

export function markPlannerItemPaid(
  db: Database.Database,
  id: number,
  paidDate = asDateString(new Date()),
): PlannerItem | null {
  validateDate(paidDate, "paid");
  const item = db.prepare(
    `SELECT id, kind, status, paid_date AS paidDate, name, provider, amount_cents AS amountCents,
            due_date AS dueDate, recurrence, notes, property_name AS propertyName,
            insured_value_cents AS insuredValueCents, policy_type AS policyType,
            policy_number AS policyNumber, payment_frequency AS paymentFrequency, renewal_date AS renewalDate,
            contents_cover_cents AS contentsCoverCents, vehicle, cover_basis AS coverBasis, policy_level AS policyLevel,
            covered_people AS coveredPeople, pet_name AS petName, cover_level AS coverLevel,
            trip_destination AS tripDestination, coverage_start_date AS coverageStartDate,
            coverage_end_date AS coverageEndDate, insured_person AS insuredPerson, waiting_period AS waitingPeriod,
            benefit_period AS benefitPeriod, other_description AS otherDescription
     FROM planner_item WHERE id = ?`,
  ).get(id) as Omit<PlannerItem, "nextDueDate"> | undefined;
  if (!item || item.kind !== "bill" || item.status !== "upcoming") return null;

  const occurrenceDate = nextDueDate(item.dueDate, item.recurrence, new Date(`${paidDate}T12:00:00`));
  const completePayment = db.transaction((): number => {
    if (item.recurrence === "none") {
      db.prepare("UPDATE planner_item SET status = 'paid', paid_date = ? WHERE id = ? AND status = 'upcoming'")
        .run(paidDate, id);
      return id;
    } else {
      const afterOccurrence = new Date(`${occurrenceDate}T12:00:00`);
      afterOccurrence.setDate(afterOccurrence.getDate() + 1);
      const nextDate = nextDueDate(occurrenceDate, item.recurrence, afterOccurrence);
      const history = db.prepare(
        `INSERT INTO planner_item (kind, status, paid_date, name, provider, amount_cents, due_date, recurrence, notes,
                                   property_name, insured_value_cents, policy_type)
         VALUES ('bill', 'paid', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(paidDate, item.name, item.provider, item.amountCents, occurrenceDate, item.recurrence, item.notes, item.propertyName, item.insuredValueCents, item.policyType);
      db.prepare("UPDATE planner_item SET due_date = ?, status = 'upcoming', paid_date = NULL WHERE id = ? AND status = 'upcoming'")
        .run(nextDate, id);
      return Number(history.lastInsertRowid);
    }
  });
  return getPlannerItem(db, completePayment());
}

function getPlannerItem(db: Database.Database, id: number, now = new Date()): PlannerItem {
  const item = db.prepare(
    `SELECT id, kind, status, paid_date AS paidDate, name, provider, amount_cents AS amountCents, due_date AS dueDate,
            recurrence, notes, property_name AS propertyName, insured_value_cents AS insuredValueCents, policy_type AS policyType,
            policy_number AS policyNumber, payment_frequency AS paymentFrequency, renewal_date AS renewalDate,
            contents_cover_cents AS contentsCoverCents, vehicle, cover_basis AS coverBasis, policy_level AS policyLevel,
            covered_people AS coveredPeople, pet_name AS petName, cover_level AS coverLevel,
            trip_destination AS tripDestination, coverage_start_date AS coverageStartDate,
            coverage_end_date AS coverageEndDate, insured_person AS insuredPerson, waiting_period AS waitingPeriod,
            benefit_period AS benefitPeriod, other_description AS otherDescription
     FROM planner_item WHERE id = ?`,
  ).get(id) as Omit<PlannerItem, "nextDueDate"> | undefined;
  if (!item) throw new Error("That bill could not be loaded after saving.");
  const nextDate = item.kind === "insurance"
    ? nextInsurancePaymentDate(
      item.dueDate,
      item.paymentFrequency || (item.recurrence === "none" ? "one-off" : item.recurrence),
      now,
    )
    : nextDueDate(item.dueDate, item.recurrence, now);
  return {
    ...item,
    nextDueDate: item.status === "paid" ? item.paidDate ?? item.dueDate : nextDate,
  };
}

function validatePlannerItem(input: PlannerItemInput): void {
  if (input.kind !== "bill" && input.kind !== "insurance") throw new Error("Choose a valid item type.");
  if (typeof input.name !== "string" || !input.name.trim() || input.name.trim().length > 100) {
    throw new Error("Enter a name of up to 100 characters.");
  }
  if (typeof input.provider !== "string" || input.provider.length > 100) {
    throw new Error("Provider must be 100 characters or fewer.");
  }
  if (input.kind === "insurance") {
    if (!Number.isSafeInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > 100_000_000_000) {
      throw new Error("Enter a premium of $0 to $1 billion.");
    }
    if (!input.provider.trim()) throw new Error("Enter an insurer.");
  } else {
    validateAmount(input.amountCents, "amount");
  }
  validateDate(input.dueDate, "due");
  if (!["none", "weekly", "fortnightly", "monthly", "quarterly", "yearly"].includes(input.recurrence)) {
    throw new Error("Choose a valid recurrence.");
  }
  if (typeof input.notes !== "string" || input.notes.length > 300) {
    throw new Error("Notes must be 300 characters or fewer.");
  }
  if (input.kind === "insurance") {
    const policyType = input.policyType ?? "home";
    if (!["home", "auto", "car", "health", "pet", "travel", "life", "income", "incomeProtection", "other"].includes(policyType)) {
      throw new Error("Choose a valid insurance type.");
    }
    const frequency = input.paymentFrequency ?? (input.recurrence === "none" ? "one-off" : input.recurrence);
    if (!["weekly", "fortnightly", "monthly", "quarterly", "half-yearly", "yearly", "one-off"].includes(frequency)) {
      throw new Error("Choose a valid insurance payment frequency.");
    }
    if (input.policyNumber !== undefined && (typeof input.policyNumber !== "string" || input.policyNumber.length > 100)) {
      throw new Error("Policy number must be 100 characters or fewer.");
    }
    const activeType = normalizeInsuranceType(policyType);
    const detailFields = INSURANCE_TYPE_FIELDS[activeType];
    const optionalTextFields: Partial<Record<InsuranceDetailField, [string, string | undefined, number]>> = {
      vehicle: ["vehicle", input.vehicle, 100],
      coverBasis: ["cover basis", input.coverBasis, 30],
      policyLevel: ["policy or cover level", input.policyLevel, 100],
      coveredPeople: ["covered people", input.coveredPeople, 200],
      petName: ["pet name", input.petName, 100],
      coverLevel: ["cover level", input.coverLevel, 100],
      tripDestination: ["trip or destination", input.tripDestination, 150],
      insuredPerson: ["insured person", input.insuredPerson, 100],
      waitingPeriod: ["waiting period", input.waitingPeriod, 80],
      benefitPeriod: ["benefit period", input.benefitPeriod, 80],
      description: ["description", input.otherDescription, 300],
    };
    for (const [field, details] of Object.entries(optionalTextFields) as Array<[InsuranceDetailField, [string, string | undefined, number]]>) {
      const [label, value, maxLength] = details;
      if (detailFields.includes(field) && value !== undefined && (typeof value !== "string" || value.length > maxLength)) {
        throw new Error(`${label} must be ${maxLength} characters or fewer.`);
      }
    }
    if (input.renewalDate) validateDate(input.renewalDate, "renewal");
    if (activeType === "travel") {
      validateTravelCoverageDates(input.coverageStartDate ?? "", input.coverageEndDate ?? "");
    }
    if (detailFields.includes("coverBasis") && input.coverBasis && !["agreed", "market", "agreed value", "market value"].includes(input.coverBasis.trim().toLowerCase())) {
      throw new Error("Choose an agreed or market value cover basis.");
    }
    const propertyName = input.propertyName ?? "Home";
    const insuredValueCents = input.insuredValueCents ?? 0;
    const coverAmounts: Array<[string, number]> = [];
    if (detailFields.includes("insuredValue") || detailFields.includes("buildingCover") || detailFields.includes("monthlyBenefit")) {
      coverAmounts.push(["insured value", insuredValueCents]);
    }
    if (detailFields.includes("contentsCover")) coverAmounts.push(["contents cover", input.contentsCoverCents ?? 0]);
    for (const [label, amount] of coverAmounts) {
      if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000_000) {
        throw new Error(`Enter ${label} of $0 to $1 billion.`);
      }
    }
    if (detailFields.includes("propertyName")) {
      if (typeof propertyName !== "string" || propertyName.length > 80) throw new Error("Property or home must be 80 characters or fewer.");
      if (!propertyName.trim()) throw new Error("Enter a property or home.");
    }
  }
}

function validatePlannerStatus(kind: PlannerKind, status: PlannerStatus, paidDate: string | null): void {
  if (status !== "upcoming" && status !== "paid") throw new Error("Choose a valid bill status.");
  if (status === "paid") {
    if (kind !== "bill" || paidDate === null) throw new Error("Only a bill with a paid date can be marked paid.");
    validateDate(paidDate, "paid");
  } else if (paidDate !== null) {
    throw new Error("Upcoming items cannot have a paid date.");
  }
}

function nextDueDate(dueDate: string, recurrence: Recurrence, now: Date): string {
  const due = new Date(`${dueDate}T12:00:00`);
  if (recurrence === "none" || due >= now) return dueDate;
  const anchorDay = due.getDate();
  while (due < now) {
    if (recurrence === "weekly") due.setDate(due.getDate() + 7);
    else if (recurrence === "fortnightly") due.setDate(due.getDate() + 14);
    else if (recurrence === "monthly" || recurrence === "quarterly") {
      const monthStep = recurrence === "monthly" ? 1 : 3;
      due.setDate(1);
      due.setMonth(due.getMonth() + monthStep);
      const lastDay = new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate();
      due.setDate(Math.min(anchorDay, lastDay));
    } else if (recurrence === "yearly") {
      const year = due.getFullYear() + 1;
      const lastDay = new Date(year, due.getMonth() + 1, 0).getDate();
      due.setFullYear(year, due.getMonth(), Math.min(anchorDay, lastDay));
    }
  }
  return `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, "0")}-${String(due.getDate()).padStart(2, "0")}`;
}

export function getFinanceReport(
  db: Database.Database,
  selectionOrNow: PeriodSelection | Date = { unit: "month", date: localDateString(new Date()) },
  reportingNow = new Date(),
): FinanceReport {
  const selection = selectionOrNow instanceof Date
    ? { unit: "month" as const, date: localDateString(selectionOrNow) }
    : selectionOrNow;
  const now = selectionOrNow instanceof Date ? selectionOrNow : reportingNow;
  const range = getPeriodRange(selection);
  const endDate = new Date(`${range.endDateExclusive}T12:00:00`);
  endDate.setDate(endDate.getDate() - 1);
  const today = localDateString(now);
  const actualEntries = db.prepare(
    `SELECT kind, amount_cents AS amountCents, category, entry_date AS entryDate
     FROM finance_entry WHERE entry_date >= ? AND entry_date < ?`,
  ).all(range.startDate, range.endDateExclusive) as Array<{
    kind: EntryKind;
    amountCents: number;
    category: string;
    entryDate: string;
  }>;
  const paidBills = db.prepare(
    `SELECT amount_cents AS amountCents, paid_date AS paidDate
     FROM planner_item
     WHERE kind = 'bill' AND status = 'paid' AND paid_date >= ? AND paid_date < ?`,
  ).all(range.startDate, range.endDateExclusive) as Array<{ amountCents: number; paidDate: string }>;

  const incomeCents = actualEntries
    .filter((entry) => entry.kind === "income")
    .reduce((total, entry) => total + entry.amountCents, 0);
  const spendingEntries = actualEntries.filter((entry) => entry.kind === "spending");
  const spendingCents = spendingEntries.reduce((total, entry) => total + entry.amountCents, 0);
  const billsPaidCents = paidBills.reduce((total, bill) => total + bill.amountCents, 0);
  const totalOutgoingsCents = spendingCents + billsPaidCents;
  const buckets = new Map<string, { incomeCents: number; spendingCents: number; billsPaidCents: number }>();
  const bucketForDate = (date: string) => range.unit === "financialYear" ? date.slice(0, 7) : date;
  const cursor = new Date(`${range.startDate}T12:00:00`);
  while (localDateString(cursor) < range.endDateExclusive) {
    const date = localDateString(cursor);
    const bucket = bucketForDate(date);
    if (!buckets.has(bucket)) buckets.set(bucket, { incomeCents: 0, spendingCents: 0, billsPaidCents: 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  for (const entry of actualEntries) {
    const bucket = buckets.get(bucketForDate(entry.entryDate));
    if (!bucket) continue;
    if (entry.kind === "income") bucket.incomeCents += entry.amountCents;
    else bucket.spendingCents += entry.amountCents;
  }
  for (const bill of paidBills) {
    const bucket = buckets.get(bucketForDate(bill.paidDate));
    if (bucket) bucket.billsPaidCents += bill.amountCents;
  }

  const categoryTotals = new Map<string, number>();
  for (const entry of spendingEntries) {
    categoryTotals.set(entry.category, (categoryTotals.get(entry.category) ?? 0) + entry.amountCents);
  }
  if (billsPaidCents > 0) {
    categoryTotals.set("Bills", (categoryTotals.get("Bills") ?? 0) + billsPaidCents);
  }
  const categories = [...categoryTotals]
    .map(([category, amount]) => ({ category, spendingCents: amount }))
    .sort((left, right) => right.spendingCents - left.spendingCents);

  const upcomingItems: FinanceReport["upcomingItems"] = [];
  if (isPeriodCurrentOrFuture(range, today)) {
    const bills = listPlannerItems(db, "bill", now);
    const insurance = listPlannerItems(db, "insurance", now);
    for (const item of [...bills, ...insurance]) {
      if (item.status !== "upcoming" || !isDateInPeriod(item.nextDueDate, range)) continue;
      upcomingItems.push({
        id: -item.id,
        title: item.name,
        dueDate: item.nextDueDate,
        amountCents: item.amountCents,
        kind: item.kind === "bill" ? "bill" : "renewal",
      });
    }
    const otherItems = db.prepare(
      `SELECT id, title, due_date AS dueDate, amount_cents AS amountCents, kind
       FROM upcoming_item WHERE due_date >= ? AND due_date < ?`,
    ).all(range.startDate, range.endDateExclusive) as Array<{
      id: number;
      title: string;
      dueDate: string;
      amountCents: number;
      kind: string;
    }>;
    upcomingItems.push(...otherItems.map((item) => ({
      ...item,
      kind: item.kind === "bill" ? "bill" as const : "renewal" as const,
    })));
    upcomingItems.sort((left, right) => left.dueDate.localeCompare(right.dueDate));
  }
  const upcomingBillsCents = upcomingItems
    .filter((item) => item.kind === "bill")
    .reduce((total, item) => total + item.amountCents, 0);

  return {
    period: range.unit,
    startDate: range.startDate,
    endDate: localDateString(endDate),
    hasActivity: incomeCents > 0 || totalOutgoingsCents > 0,
    series: [...buckets].map(([bucket, values]) => ({ bucket, ...values })),
    categories,
    incomeCents,
    spendingCents,
    billsPaidCents,
    totalOutgoingsCents,
    netCashFlowCents: incomeCents - totalOutgoingsCents,
    upcomingBillsCents,
    upcomingItems,
  };
}

export function getDashboardEntryHistory(db: Database.Database, now = new Date()): Array<{
  month: string;
  incomeCents: number;
  spendingCents: number;
}> {
  const actual = db.prepare(
    `SELECT month, SUM(incomeCents) AS incomeCents, SUM(spendingCents) AS spendingCents
     FROM (
       SELECT substr(entry_date, 1, 7) AS month,
              CASE WHEN kind = 'income' THEN amount_cents ELSE 0 END AS incomeCents,
              CASE WHEN kind = 'spending' THEN amount_cents ELSE 0 END AS spendingCents
       FROM finance_entry
       UNION ALL
       SELECT substr(paid_date, 1, 7), 0, amount_cents
       FROM planner_item WHERE kind = 'bill' AND status = 'paid' AND paid_date IS NOT NULL
     )
     WHERE month >= strftime('%Y-%m', date(?, '-5 months', 'start of month'))
     GROUP BY month ORDER BY month`,
  ).all(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`) as Array<{
    month: string;
    incomeCents: number;
    spendingCents: number;
  }>;
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    return asDateString(date).slice(0, 7);
  });
  const scheduledIncome = recurringIncomeByMonth(db, months);
  const actualByMonth = new Map(actual.map((item) => [item.month, item]));
  return months
    .filter((month) => actualByMonth.has(month) || (scheduledIncome.get(month) ?? 0) > 0)
    .map((month) => {
      const entry = actualByMonth.get(month);
      return {
        month,
        incomeCents: (entry?.incomeCents ?? 0) + (scheduledIncome.get(month) ?? 0),
        spendingCents: entry?.spendingCents ?? 0,
      };
    });
}

export function getPlannerUpcoming(
  db: Database.Database,
  now = new Date(),
): Array<{ id: number; title: string; dueDate: string; amountCents: number; kind: "bill" | "renewal" }> {
  const rows = db.prepare(
    `SELECT id, name AS title, due_date AS dueDate, amount_cents AS amountCents,
            kind, recurrence FROM planner_item
     WHERE kind = 'insurance' OR status = 'upcoming'`,
  ).all() as Array<{
    id: number;
    title: string;
    dueDate: string;
    amountCents: number;
    kind: PlannerKind;
    recurrence: Recurrence;
  }>;
  const upcoming = rows.map((row): { id: number; title: string; dueDate: string; amountCents: number; kind: "bill" | "renewal" } => ({
    id: -row.id,
    title: row.title,
    dueDate: nextDueDate(row.dueDate, row.recurrence, now),
    amountCents: row.amountCents,
    kind: row.kind === "insurance" ? "renewal" : "bill",
  }));
  return upcoming.filter((item) => item.dueDate >= now.toISOString().slice(0, 10))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}
