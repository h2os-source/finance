export type StatementReviewDestination = "spending" | "income" | "bill" | "ignore";

export interface StatementReviewRow {
  selected: boolean;
  destination: StatementReviewDestination;
}

export function partitionSelectedStatementRows<T extends StatementReviewRow>(rows: readonly T[]) {
  const selectedRows = rows.filter((row) => row.selected);
  return {
    entries: selectedRows.filter((row) => row.destination === "spending" || row.destination === "income"),
    bills: selectedRows.filter((row) => row.destination === "bill"),
  };
}
