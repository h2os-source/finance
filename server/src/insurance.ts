export const INSURANCE_TYPES = [
  "home",
  "car",
  "health",
  "pet",
  "travel",
  "life",
  "incomeProtection",
  "other",
] as const;

export type InsuranceType = (typeof INSURANCE_TYPES)[number];
export type InsurancePolicyType = InsuranceType | "auto" | "income";
export type InsurancePaymentFrequency =
  | "weekly"
  | "fortnightly"
  | "monthly"
  | "quarterly"
  | "half-yearly"
  | "yearly"
  | "one-off";

export const INSURANCE_TYPE_LABELS: Record<InsuranceType, string> = {
  home: "Home",
  car: "Car",
  health: "Health",
  pet: "Pet",
  travel: "Travel",
  life: "Life",
  incomeProtection: "Income Protection",
  other: "Other",
};

export const INSURANCE_FREQUENCY_LABELS: Record<InsurancePaymentFrequency, string> = {
  weekly: "Weekly",
  fortnightly: "Fortnightly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  "half-yearly": "Half-yearly",
  yearly: "Yearly",
  "one-off": "One-off",
};

export type InsuranceDetailField =
  | "propertyName"
  | "buildingCover"
  | "contentsCover"
  | "vehicle"
  | "coverBasis"
  | "insuredValue"
  | "policyLevel"
  | "coveredPeople"
  | "petName"
  | "coverLevel"
  | "tripDestination"
  | "coverageStartDate"
  | "coverageEndDate"
  | "insuredPerson"
  | "monthlyBenefit"
  | "waitingPeriod"
  | "benefitPeriod"
  | "description";

export const INSURANCE_TYPE_FIELDS: Record<InsuranceType, readonly InsuranceDetailField[]> = {
  home: ["propertyName", "buildingCover", "contentsCover"],
  car: ["vehicle", "coverBasis", "insuredValue"],
  health: ["policyLevel", "coveredPeople"],
  pet: ["petName", "coverLevel"],
  travel: ["tripDestination", "coverageStartDate", "coverageEndDate"],
  life: ["insuredPerson", "insuredValue"],
  incomeProtection: ["insuredPerson", "monthlyBenefit", "waitingPeriod", "benefitPeriod"],
  other: ["description", "insuredValue"],
};

export function normalizeInsuranceType(policyType: InsurancePolicyType | string): InsuranceType {
  if (policyType === "auto") return "car";
  if (policyType === "income") return "incomeProtection";
  return INSURANCE_TYPES.includes(policyType as InsuranceType) ? policyType as InsuranceType : "other";
}

export function getInsuranceTypeLabel(policyType: InsurancePolicyType | string): string {
  return INSURANCE_TYPE_LABELS[normalizeInsuranceType(policyType)];
}

export function sortInsurancePolicies<T extends { kind: string; renewalDate?: string | null; name: string }>(
  policies: readonly T[],
): T[] {
  return policies
    .filter((policy) => policy.kind === "insurance")
    .slice()
    .sort((left, right) => {
      const leftDate = left.renewalDate || "9999-12-31";
      const rightDate = right.renewalDate || "9999-12-31";
      return leftDate.localeCompare(rightDate) || left.name.localeCompare(right.name);
    });
}

export type PolicyRenewalStatus = "overdue" | "due-soon" | null;

export function getPolicyRenewalStatus(renewalDate: string | null | undefined, now = new Date()): PolicyRenewalStatus {
  if (!renewalDate || !/^\d{4}-\d{2}-\d{2}$/.test(renewalDate)) return null;
  const today = localDateString(now);
  if (renewalDate < today) return "overdue";
  const warningEnd = new Date(`${today}T12:00:00`);
  warningEnd.setDate(warningEnd.getDate() + 30);
  if (renewalDate <= localDateString(warningEnd)) return "due-soon";
  return null;
}

export function validateTravelCoverageDates(startDate: string, endDate: string): void {
  if (startDate) validateInsuranceDate(startDate, "coverage start");
  if (endDate) validateInsuranceDate(endDate, "coverage end");
  if (startDate && endDate && endDate < startDate) {
    throw new Error("Coverage end date cannot be before the coverage start date.");
  }
}

export function nextInsurancePaymentDate(
  dueDate: string,
  frequency: InsurancePaymentFrequency | "",
  now = new Date(),
): string {
  const normalizedFrequency = frequency || "one-off";
  if (normalizedFrequency === "one-off") return dueDate;
  const intervalDays: Partial<Record<InsurancePaymentFrequency, number>> = {
    weekly: 7,
    fortnightly: 14,
  };
  const monthIntervals: Partial<Record<InsurancePaymentFrequency, number>> = {
    monthly: 1,
    quarterly: 3,
    "half-yearly": 6,
    yearly: 12,
  };
  const due = new Date(`${dueDate}T12:00:00`);
  const today = localDateString(now);
  const anchorDay = due.getDate();
  while (localDateString(due) < today) {
    const days = intervalDays[normalizedFrequency];
    if (days) {
      due.setDate(due.getDate() + days);
      continue;
    }
    const months = monthIntervals[normalizedFrequency];
    if (!months) throw new Error("Choose a valid insurance payment frequency.");
    due.setDate(1);
    due.setMonth(due.getMonth() + months);
    due.setDate(Math.min(anchorDay, new Date(due.getFullYear(), due.getMonth() + 1, 0).getDate()));
  }
  return localDateString(due);
}

function validateInsuranceDate(value: string, label: string): void {
  const parsed = new Date(`${value}T12:00:00`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(parsed.getTime()) ||
    localDateString(parsed) !== value
  ) {
    throw new Error(`Enter a valid ${label} date.`);
  }
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
