import assert from "node:assert/strict";
import test from "node:test";
import {
  getCurrentPeriodSelection,
  getPeriodRange,
  isCurrentPeriod,
  navigatePeriod,
  navigateReportingPage,
  selectCurrentPeriod,
  type ReportingPageState,
} from "./timePeriods";

test("weeks start Monday and end Sunday", () => {
  const range = getPeriodRange({ unit: "week", date: "2026-11-19" });
  assert.equal(range.startDate, "2026-11-16");
  assert.equal(range.endDateExclusive, "2026-11-23");
  assert.equal(range.label, "16 Nov – 22 Nov 2026");
  assert.equal(getPeriodRange({ unit: "week", date: "2027-01-01" }).label, "28 Dec 2026 – 3 Jan 2027");
});

test("months use calendar boundaries", () => {
  const range = getPeriodRange({ unit: "month", date: "2026-02-14" });
  assert.equal(range.startDate, "2026-02-01");
  assert.equal(range.endDateExclusive, "2026-03-01");
  assert.equal(range.label, "February 2026");
});

test("Australian financial years run from July through June", () => {
  const range = getPeriodRange({ unit: "financialYear", date: "2026-11-19" });
  assert.equal(range.startDate, "2026-07-01");
  assert.equal(range.endDateExclusive, "2027-07-01");
  assert.equal(range.label, "FY 2026/27");
});

test("previous, next, and current navigation select the expected ranges", () => {
  const week = { unit: "week" as const, date: "2026-11-19" };
  assert.equal(getPeriodRange(navigatePeriod(week, -1)).startDate, "2026-11-09");
  assert.equal(getPeriodRange(navigatePeriod(week, 1)).startDate, "2026-11-23");

  const month = { unit: "month" as const, date: "2026-01-31" };
  assert.equal(getPeriodRange(navigatePeriod(month, -1)).startDate, "2025-12-01");
  assert.equal(getPeriodRange(navigatePeriod(month, 1)).startDate, "2026-02-01");

  const year = { unit: "financialYear" as const, date: "2026-11-19" };
  assert.equal(getPeriodRange(navigatePeriod(year, -1)).label, "FY 2025/26");
  assert.equal(getPeriodRange(navigatePeriod(year, 1)).label, "FY 2027/28");
  const now = new Date(2026, 10, 19, 12);
  const currentWeek = selectCurrentPeriod({ unit: "week", date: "2026-01-01" }, now);
  assert.deepEqual(currentWeek, { unit: "week", date: "2026-11-19" });
  assert.equal(getPeriodRange(currentWeek).startDate, "2026-11-16");
  assert.equal(isCurrentPeriod({ unit: "month", date: "2026-01-01" }, now), false);
  assert.equal(isCurrentPeriod(getCurrentPeriodSelection(now), now), true);
});

test("changing among reporting pages preserves the shared period selection", () => {
  const period = { unit: "week" as const, date: "2026-11-19" };
  let state: ReportingPageState = { activePage: "Dashboard", period };
  for (const page of ["Income", "Spending", "Bills", "Reports", "Dashboard"]) {
    state = navigateReportingPage(state, page);
    assert.deepEqual(state.period, period);
  }
});
