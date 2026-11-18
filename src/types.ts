import type {
  InsurancePaymentFrequency,
  InsurancePolicyType,
} from "../server/src/insurance";
import type { BudgetGroup } from "../server/src/budget";

export interface AuthStatus {
  setupRequired: boolean;
  authenticated: boolean;
  displayName: string | null;
}

export interface DashboardData {
  sampleDataPresent: boolean;
  personalDataPresent: boolean;
  mortgageIsMock: boolean;
  accountsAreMock: boolean;
  updatedAt: string;
  netPositionCents: number;
  cashCents: number;
  offsetCents: number;
  superCents: number;
  mortgageCents: number;
  propertyCoverage: Array<{
    propertyName: string;
    propertyValueCents: number;
    insuredValueCents: number;
    gapCents: number;
  }>;
  otherLoanCents: number;
  monthlyIncomeCents: number;
  monthlySpendingCents: number;
  monthlySurplusCents: number;
  spendingHistory: Array<{ month: string; incomeCents: number; spendingCents: number }>;
  upcoming: Array<{
    id: number;
    title: string;
    dueDate: string;
    amountCents: number;
    kind: "bill" | "renewal";
  }>;
  budgets: Array<{ category: string; spentCents: number; limitCents: number }>;
}

export type AccountType = "cash" | "offset" | "super";

export interface FinancialAccount {
  id: number;
  institution: string;
  name: string;
  websiteUrl: string;
  bsb: string;
  accountNumber: string;
  notes: string;
  type: AccountType;
  balanceCents: number;
  isMock: boolean;
}

export interface MortgageSplit {
  id: number;
  name: string;
  propertyName: string;
  propertyValueCents: number;
  balanceCents: number;
  interestRateBps: number | null;
  repaymentCents: number | null;
  rateType: "variable" | "fixed";
  fixedRateEndDate: string;
  repaymentFrequency: "weekly" | "fortnightly" | "monthly";
  updatedAt: string;
}

export type LoanType = "personal" | "car" | "student" | "other";

export interface Loan {
  id: number;
  name: string;
  lender: string;
  type: LoanType;
  balanceCents: number;
  interestRateBps: number | null;
  repaymentCents: number | null;
  repaymentFrequency: "weekly" | "fortnightly" | "monthly";
  updatedAt: string;
}

export type EntryKind = "income" | "spending";
export type PlannerKind = "bill" | "insurance";
export type Recurrence = "none" | "weekly" | "fortnightly" | "monthly" | "quarterly" | "yearly";

export interface FinanceEntry {
  id: number;
  kind: EntryKind;
  amountCents: number;
  category: string;
  description: string;
  entryDate: string;
}

export interface FinanceEntryInput extends Omit<FinanceEntry, "id"> {}

export type StatementDestination = "spending" | "income" | "bill" | "ignore";

export interface StatementTransaction {
  date: string;
  description: string;
  amountCents: number;
  direction: "out" | "in" | "unknown";
  category: string;
  destination: StatementDestination;
  possibleDuplicate: boolean;
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

export interface RecurringIncomeInput extends Omit<RecurringIncome, "id"> {}

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

export type PlannerStatus = "upcoming" | "paid";

export type PolicyType = InsurancePolicyType;

export type PlannerItemInput = Omit<
  PlannerItem,
  "id" | "nextDueDate" | "status" | "paidDate" | "propertyName" | "insuredValueCents" | "policyType" |
  "policyNumber" | "paymentFrequency" | "renewalDate" | "contentsCoverCents" | "vehicle" | "coverBasis" |
  "policyLevel" | "coveredPeople" | "petName" | "coverLevel" | "tripDestination" | "coverageStartDate" |
  "coverageEndDate" | "insuredPerson" | "waitingPeriod" | "benefitPeriod" | "otherDescription"
> & {
  propertyName?: string;
  insuredValueCents?: number;
  policyType?: PolicyType;
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

export interface FinanceReport {
  period: "week" | "month" | "financialYear";
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
