import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { filterReport } from "../src/reportFilters.ts";
import { createExcelReport } from "../src/excel.ts";
const require = createRequire(import.meta.url);
const ExcelJS = require("exceljs");
const data = {
  ingredients: [
    { id: "flour", name: "Flour", unit: "kg", threshold: 0 },
    { id: "oil", name: "Oil", unit: "L", threshold: 0 },
  ],
  batches: [
    {
      id: "f",
      ingredientId: "flour",
      code: "F1",
      received: "2026-01-01",
      expiry: "2027-01-01",
      quantity: 10,
    },
    {
      id: "o",
      ingredientId: "oil",
      code: "O1",
      received: "2026-01-01",
      expiry: "2027-01-01",
      quantity: 20,
    },
  ],
  movements: [],
};
data.movements = [
  ["before", 16, 23, 59, "flour"],
  ["start", 17, 0, 0, "flour"],
  ["end", 18, 23, 59, "flour"],
  ["after", 19, 0, 0, "flour"],
  ["oil", 17, 12, 0, "oil"],
].map(([id, day, hour, minute, ingredientId]) => ({
  id,
  ingredientId,
  batchId: ingredientId === "oil" ? "o" : "f",
  batch: ingredientId === "oil" ? "O1" : "F1",
  quantity: 1,
  type: "received",
  date: new Date(2026, 9, day, hour, minute).toISOString(),
}));
test("all dates and ingredients retain the complete data without mutating it", () => {
  const before = JSON.stringify(data);
  const selected = filterReport(data);
  assert.equal(selected.batches.length, 2);
  assert.equal(selected.movements.length, 5);
  assert.equal(JSON.stringify(data), before);
});
test("ranges include both full days using local dates", () => {
  const selected = filterReport(data, {
    from: "2026-10-17",
    to: "2026-10-18",
    ingredientIds: ["flour"],
  });
  assert.deepEqual(
    selected.movements.map((m) => m.id),
    ["end", "start"],
  );
  assert.deepEqual(
    selected.ingredients.map((i) => i.id),
    ["flour"],
  );
  assert.deepEqual(
    selected.batches.map((b) => b.id),
    ["f"],
  );
  assert.equal(selected.batches[0].quantity, 10);
});
test("multiple selections and a range with no movements are supported", () => {
  assert.equal(
    filterReport(data, { ingredientIds: ["flour", "oil"] }).movements.length,
    5,
  );
  const selected = filterReport(data, {
    from: "2026-11-01",
    to: "2026-11-02",
    ingredientIds: ["oil"],
  });
  assert.equal(selected.movements.length, 0);
  assert.equal(selected.batches.length, 1);
});
test("invalid ranges and empty or unknown ingredient selections are rejected", () => {
  for (const filters of [
    { from: "2026-02-30" },
    { from: "2026-10-18", to: "2026-10-17" },
    { ingredientIds: [] },
    { ingredientIds: ["unknown"] },
  ])
    assert.throws(() => filterReport(data, filters));
});
test("exported workbook contains only the selected ingredient and period", async () => {
  const selected = filterReport(data, {
    from: "2026-10-17",
    to: "2026-10-18",
    ingredientIds: ["flour"],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(
      await createExcelReport(selected, "Flour · 2026-10-17 to 2026-10-18"),
    ),
  );
  assert.equal(workbook.getWorksheet("Stock").rowCount, 2);
  assert.equal(workbook.getWorksheet("Movements").rowCount, 3);
  assert.equal(workbook.getWorksheet("Stock").getCell("A2").value, "Flour");
  assert.equal(
    workbook.getWorksheet("Movements").getCell("A2").value,
    data.movements.find((m) => m.id === "end").date,
  );
  assert.ok(
    workbook.getWorksheet("Report").getCell("B1").value.includes("2026-10-17"),
  );
});
