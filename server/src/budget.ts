import type { BudgetFrequency, BudgetSourceType } from "./finance";

export const BUDGET_GROUPS = [
  "Essentials",
  "Savings & Goals",
  "Lifestyle",
  "Luxury",
  "Other",
] as const;

export type BudgetGroup = (typeof BUDGET_GROUPS)[number];

export const BUDGET_CATEGORIES: Record<BudgetGroup, readonly string[]> = {
  Essentials: [
    "Groceries",
    "Fuel / Transport",
    "Medical / Health",
    "Household",
    "Education / Children",
    "Pet costs",
  ],
  "Savings & Goals": [
    "Emergency fund",
    "General savings",
    "Investing",
    "Extra mortgage repayment",
    "Extra debt repayment",
    "Holiday / major purchase goal",
  ],
  Lifestyle: [
    "Clothing",
    "Eating out",
    "Entertainment",
    "Hobbies",
    "Gaming",
    "Subscriptions",
    "Personal spending",
  ],
  Luxury: [
    "Takeaway coffee",
    "Premium dining",
    "Alcohol",
    "Luxury purchases",
    "Impulse spending",
    "Other luxury",
  ],
  Other: ["Other"],
};

const periodsPerYear: Record<BudgetFrequency, number> = {
  weekly: 52,
  fortnightly: 26,
  monthly: 12,
};

export function isBudgetGroup(value: unknown): value is BudgetGroup {
  return typeof value === "string" && (BUDGET_GROUPS as readonly string[]).includes(value);
}

export function monthlyEquivalentCents(amountCents: number, frequency: BudgetFrequency): number {
  return Math.round(amountCents * periodsPerYear[frequency] / 12);
}

export function calculateBudgetSummary(
  incomeCents: number,
  fixedCommitmentsCents: number,
  allocatedCents: number,
): { availableCents: number; remainingCents: number; overBudgetCents: number } {
  const availableCents = incomeCents - fixedCommitmentsCents;
  const remainingCents = availableCents - allocatedCents;
  return {
    availableCents,
    remainingCents,
    overBudgetCents: Math.max(0, -remainingCents),
  };
}

export function calculateBudgetAllocations(
  budgets: ReadonlyArray<{
    limitCents: number;
    frequency: BudgetFrequency;
    sourceType: BudgetSourceType;
  }>,
): number {
  return budgets.reduce((total, budget) => (
    total + (budget.sourceType === "other" ? monthlyEquivalentCents(budget.limitCents, budget.frequency) : 0)
  ), 0);
}

export function getSavingsGoalWarning(
  budgets: ReadonlyArray<{
    group: BudgetGroup;
    limitCents: number;
    spentCents: number;
    frequency: BudgetFrequency;
  }>,
  luxuryAllocatedCents: number,
): { remainingTargetCents: number; luxuryAllocatedCents: number } | null {
  if (luxuryAllocatedCents <= 0) return null;
  const remainingTargetCents = budgets
    .filter((budget) => budget.group === "Savings & Goals" && budget.limitCents > 0)
    .reduce((total, budget) => (
      total + Math.max(
        0,
        monthlyEquivalentCents(budget.limitCents, budget.frequency) -
        monthlyEquivalentCents(budget.spentCents, budget.frequency),
      )
    ), 0);
  return remainingTargetCents > 0 ? { remainingTargetCents, luxuryAllocatedCents } : null;
}
