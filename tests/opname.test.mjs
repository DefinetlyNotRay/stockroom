import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startCount,
  mergeCounts,
  countEntries,
  applyCount,
} from "../src/opname.ts";
import { createCountReport, readCountFile } from "../src/excel.ts";
import ExcelJS from "exceljs";
const data = {
  ingredients: [{ id: "i", name: "Flour", unit: "kg", threshold: 0 }],
  batches: ["001", "002", "003"].map((code, i) => ({
    id: code,
    ingredientId: "i",
    code,
    quantity: 10 + i,
    received: "2026-01-01",
    expiry: "2099-01-01",
  })),
  movements: [],
};
test("imports are atomic, keyed by name and batch, and distinguish zero from blank", () => {
  const draft = startCount(data);
  const result = mergeCounts(draft, [
    { name: " flour ", batch: "001", count: "0", row: 2 },
    { name: "Flour", batch: "002", count: "", row: 3 },
  ]);
  assert.equal(draft.rows[0].count, "");
  assert.equal(result.rows[0].count, "0");
  assert.equal(countEntries(result, data).length, 1);
  for (const rows of [
    [{ name: "Unknown", batch: "001", count: "2", row: 2 }],
    [{ name: "Flour", batch: "001", count: "-1", row: 2 }],
    [2, 3].map((row) => ({ name: "Flour", batch: "001", count: "2", row })),
  ])
    assert.throws(() => mergeCounts(draft, rows));
  const applied = applyCount(result, data, "2026-10-18T00:00:00Z");
  assert.deepEqual(
    applied.batches.map((b) => b.quantity),
    [0, 11, 12],
  );
  assert.equal(applied.movements[0].quantity, -10);
  assert.equal(applied.movements[0].type, "adjusted");
  assert.throws(() => countEntries(result, applied), /Stock changed/);
});
test("unchanged counted rows also participate in conflict checks", () => {
  const draft = startCount(data);
  draft.rows[0].count = "10";
  assert.equal(countEntries(draft, data).length, 1);
  const newer = structuredClone(data);
  newer.batches[0].quantity = 9;
  assert.throws(
    () => applyCount(draft, newer, "2026-10-18T00:00:00Z"),
    /Stock changed/,
  );
});
test("template imports round-trip text batch numbers and comparison exports retain numeric zeros", async () => {
  const draft = startCount(data);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(await createCountReport(draft, true)));
  const sheet = workbook.worksheets[0];
  assert.equal(sheet.getCell("B2").value, "001");
  sheet.getCell("C2").value = 0;
  sheet.getCell("C3").value = 15.125;
  const result = await readCountFile(
    new Uint8Array(await workbook.xlsx.writeBuffer()),
    draft,
  );
  assert.deepEqual(
    result.rows.map((r) => r.count),
    ["0", "15.125", ""],
  );
  const comparison = new ExcelJS.Workbook();
  await comparison.xlsx.load(Buffer.from(await createCountReport(result)));
  const view = comparison.worksheets[0];
  assert.equal(view.getCell("D2").value, 0);
  assert.equal(view.getCell("E2").value, -10);
  assert.equal(view.getCell("D4").value, null);
  assert.equal(view.getCell("G4").value, "Not counted");
  sheet.getCell("C2").value = { formula: "1+1", result: 2 };
  await assert.rejects(
    readCountFile(new Uint8Array(await workbook.xlsx.writeBuffer()), draft),
    /plain values/,
  );
});
