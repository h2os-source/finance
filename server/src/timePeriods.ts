export type PeriodUnit = "week" | "month" | "financialYear";

export interface PeriodSelection {
  unit: PeriodUnit;
  date: string;
}

export interface PeriodRange {
  unit: PeriodUnit;
  startDate: string;
  endDateExclusive: string;
  label: string;
}

export interface ReportingPageState {
  activePage: string;
  period: PeriodSelection;
}

function parseLocalDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Choose a valid reporting date.");
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    throw new Error("Choose a valid reporting date.");
  }
  return date;
}

export function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function getCurrentPeriodSelection(now = new Date()): PeriodSelection {
  return { unit: "month", date: localDateString(now) };
}

export function selectCurrentPeriod(selection: PeriodSelection, now = new Date()): PeriodSelection {
  return { ...selection, date: localDateString(now) };
}

export function getPeriodRange(selection: PeriodSelection): PeriodRange {
  if (!["week", "month", "financialYear"].includes(selection.unit)) {
    throw new Error("Choose a valid reporting period.");
  }
  const selectedDate = parseLocalDate(selection.date);
  let start: Date;
  let end: Date;
  let label: string;

  if (selection.unit === "week") {
    start = new Date(selectedDate);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    end = new Date(start);
    end.setDate(end.getDate() + 7);
    const lastDate = new Date(end);
    lastDate.setDate(lastDate.getDate() - 1);
    const sameYear = start.getFullYear() === lastDate.getFullYear();
    const startLabel = new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      month: "short",
      ...(sameYear ? {} : { year: "numeric" }),
    }).format(start);
    const endLabel = new Intl.DateTimeFormat("en-AU", {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(lastDate);
    label = `${startLabel} – ${endLabel}`;
  } else if (selection.unit === "month") {
    start = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1, 12);
    end = new Date(selectedDate.getFullYear(), selectedDate.getMonth() + 1, 1, 12);
    label = new Intl.DateTimeFormat("en-AU", { month: "long", year: "numeric" }).format(start);
  } else {
    const startYear = selectedDate.getMonth() >= 6 ? selectedDate.getFullYear() : selectedDate.getFullYear() - 1;
    start = new Date(startYear, 6, 1, 12);
    end = new Date(startYear + 1, 6, 1, 12);
    label = `FY ${startYear}/${String(startYear + 1).slice(-2)}`;
  }

  return {
    unit: selection.unit,
    startDate: localDateString(start),
    endDateExclusive: localDateString(end),
    label,
  };
}

export function navigatePeriod(selection: PeriodSelection, direction: -1 | 1): PeriodSelection {
  const range = getPeriodRange(selection);
  const start = parseLocalDate(range.startDate);
  if (selection.unit === "week") start.setDate(start.getDate() + direction * 7);
  else if (selection.unit === "month") start.setMonth(start.getMonth() + direction);
  else start.setFullYear(start.getFullYear() + direction);
  return { unit: selection.unit, date: localDateString(start) };
}

export function isCurrentPeriod(selection: PeriodSelection, now = new Date()): boolean {
  const current = getPeriodRange(selectCurrentPeriod(selection, now));
  return getPeriodRange(selection).startDate === current.startDate;
}

export function isDateInPeriod(date: string, range: PeriodRange): boolean {
  return date >= range.startDate && date < range.endDateExclusive;
}

export function isPeriodCurrentOrFuture(range: PeriodRange, today = localDateString(new Date())): boolean {
  return range.endDateExclusive > today;
}

export function updateReportingPeriod(state: ReportingPageState, period: PeriodSelection): ReportingPageState {
  return { ...state, period };
}

export function navigateReportingPage(state: ReportingPageState, activePage: string): ReportingPageState {
  return { ...state, activePage };
}
