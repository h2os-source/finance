import assert from "node:assert/strict";
import { test } from "node:test";
import { partitionSelectedStatementRows } from "./statementImportReview";

test("statement review excludes ignored rows while retaining selected import destinations", () => {
  const rows = [
    { destination: "ignore" as const, selected: true, description: "Own account transfer" },
    { destination: "spending" as const, selected: true, description: "Cafe" },
    { destination: "income" as const, selected: true, description: "Salary" },
    { destination: "bill" as const, selected: true, description: "Electricity" },
    { destination: "spending" as const, selected: false, description: "Unchecked" },
  ];

  const { entries, bills } = partitionSelectedStatementRows(rows);
  assert.deepEqual(entries.map((row) => [row.destination, row.description]), [
    ["spending", "Cafe"],
    ["income", "Salary"],
  ]);
  assert.deepEqual(bills.map((row) => [row.destination, row.description]), [["bill", "Electricity"]]);
  assert.equal([...entries, ...bills].some((row) => row.destination === "ignore"), false);
});
