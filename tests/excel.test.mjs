import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const NativePromise = globalThis.Promise;
const nativeThen = Promise.prototype.then;
const { createExcelReport } = await import("../src/excel.ts");
const ExcelJS = require("exceljs");

test("loading the report writer preserves the runtime Promise", () => {
  assert.equal(globalThis.Promise, NativePromise);
  assert.equal(Promise.prototype.then, nativeThen);
});

function loadBrowserBundle(filename) {
  // No Node process or PromiseRejectionEvent: exercise core-js's non-Node path.
  const context = vm.createContext({
    module: { exports: {} },
    exports: {},
    window: {},
    document: {},
    setTimeout,
    clearTimeout,
    setImmediate,
    console,
  });
  vm.runInContext(
    "globalThis.originalPromise = Promise; globalThis.originalThen = Promise.prototype.then;",
    context,
  );
  vm.runInContext(
    readFileSync(require.resolve(`exceljs/dist/${filename}`), "utf8"),
    context,
  );
  return context;
}

test("bare browser bundle avoids the global Promise replacement in the default bundle", () => {
  const original = loadBrowserBundle("exceljs.min.js");
  assert.equal(vm.runInContext("Promise === originalPromise", original), false);
  const fixed = loadBrowserBundle("exceljs.bare.min.js");
  assert.equal(
    vm.runInContext(
      "Promise === originalPromise && Promise.prototype.then === originalThen",
      fixed,
    ),
    true,
  );
});

const data = {
  ingredients: [
    { id: "flour", name: "Flour & grains", unit: "kg", threshold: 2 },
  ],
  batches: [
    {
      id: "a",
      ingredientId: "flour",
      code: "FL-001",
      received: "2026-10-01",
      expiry: "2027-01-01",
      quantity: 12.75,
    },
  ],
  movements: [
    {
      id: "m",
      ingredientId: "flour",
      batchId: "a",
      batch: "FL-001",
      type: "adjusted",
      quantity: -1.25,
      date: "2026-10-17T01:00:00.000Z",
      reason: "Damaged <bag>",
    },
  ],
};

test("export produces a readable XLSX with numeric quantities, history, and styles", async () => {
  const bytes = await createExcelReport(data);
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual([...bytes.slice(0, 2)], [0x50, 0x4b]);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  assert.deepEqual(
    workbook.worksheets.map((s) => s.name),
    ["Stock", "Movements"],
  );
  const stock = workbook.getWorksheet("Stock");
  assert.equal(stock.getCell("A2").value, "Flour & grains");
  assert.equal(stock.getCell("C2").value, 12.75);
  assert.equal(stock.getCell("D2").value, "kg");
  assert.equal(stock.getCell("A1").font.bold, true);
  assert.equal(stock.views[0].state, "frozen");
  const movements = workbook.getWorksheet("Movements");
  assert.equal(movements.getCell("E2").value, -1.25);
  assert.equal(movements.getCell("G2").value, "Damaged <bag>");
});

test("empty inventory still exports both sheets with headers", async () => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    Buffer.from(
      await createExcelReport({ ingredients: [], batches: [], movements: [] }),
    ),
  );
  assert.equal(workbook.getWorksheet("Stock").rowCount, 1);
  assert.equal(
    workbook.getWorksheet("Movements").getCell("G1").value,
    "Reason",
  );
});

test("bare bundle can write a workbook without Node globals", async () => {
  const context = loadBrowserBundle("exceljs.bare.min.js");
  const bytes = await vm.runInContext(
    '(async () => { const wb = new module.exports.Workbook(); const sheet = wb.addWorksheet("Stock"); sheet.addRow(["Flour", 2.75]); return new Uint8Array(await wb.xlsx.writeBuffer()); })()',
    context,
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(Buffer.from(bytes));
  assert.equal(workbook.getWorksheet("Stock").getCell("B1").value, 2.75);
});
