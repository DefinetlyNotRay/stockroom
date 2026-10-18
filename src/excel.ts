// The default ExcelJS browser bundle installs core-js globally. Its Promise
// replacement conflicts with Expo/Hermes. Always use the polyfill-free bundle.
import ExcelJS from "exceljs/dist/exceljs.bare.min.js";
import type { Inventory } from "./inventory";
import { mergeCounts, type CountDraft } from "./opname.ts";

export async function readCountFile(bytes: Uint8Array, draft: CountDraft) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as never);
  const sheet =
    workbook.getWorksheet("Physical counts") || workbook.worksheets[0];
  if (!sheet) throw Error("The workbook has no worksheets.");
  const headers = new Map<string, number>();
  sheet
    .getRow(1)
    .eachCell((cell, index) =>
      headers.set(cell.text.trim().toLowerCase(), index),
    );
  const name = headers.get("name");
  const batch = headers.get("batch number");
  const count = headers.get("physical count") || headers.get("physical counts");
  if (!name || !batch || !count)
    throw Error("Row 1 must contain Name, Batch number, and Physical count.");
  if (sheet.rowCount > 20001)
    throw Error("Import at most 20,000 rows at a time.");
  const rows: { name: string; batch: string; count: string; row: number }[] =
    [];
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const values = [name, batch, count].map((col) => row.getCell(col));
    if (values.every((cell) => !cell.text.trim())) return;
    if (
      values.some(
        (cell) =>
          cell.type === ExcelJS.ValueType.Formula ||
          cell.type === ExcelJS.ValueType.Error,
      )
    )
      throw Error(`Row ${index}: use plain values, not formulas or errors.`);
    rows.push({
      name: values[0].text,
      batch: values[1].text,
      count: values[2].text,
      row: index,
    });
  });
  return mergeCounts(draft, rows);
}

export async function createCountReport(
  draft: CountDraft,
  template = false,
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stockroom";
  const sheet = workbook.addWorksheet(
    template ? "Physical counts" : "Comparison",
  );
  sheet.columns = (
    template
      ? ["Name", "Batch number", "Physical count"]
      : [
          "Name",
          "Batch number",
          "System quantity",
          "Physical count",
          "Difference",
          "Unit",
          "Status",
        ]
  ).map((header) => ({ header, width: header === "Name" ? 32 : 21 }));
  for (const row of draft.rows) {
    const count = row.count.trim() === "" ? null : Number(row.count);
    if (
      count !== null &&
      (!Number.isFinite(count) ||
        count > 1e12 ||
        !/^\d+(\.\d{1,3})?$/.test(row.count.trim()))
    )
      throw Error(
        `Check physical count for ${row.name} / ${row.batch} before exporting.`,
      );
    sheet.addRow(
      template
        ? [row.name, row.batch, null]
        : [
            row.name,
            row.batch,
            row.expected,
            count,
            count === null
              ? null
              : Math.round((count - row.expected) * 1000) / 1000,
            row.unit,
            count === null
              ? "Not counted"
              : draft.approvedAt
                ? "Approved locally"
                : "Draft",
          ],
    );
  }
  styleSheet(sheet);
  if (!template) {
    for (const column of [3, 4, 5])
      sheet.getColumn(column).numFmt = "#,##0.###;[Red]-#,##0.###;0";
    const info = workbook.addWorksheet("Session");
    info.columns = [{ width: 24 }, { width: 65 }];
    info.addRows([
      ["Session", draft.id],
      ["Started", draft.startedAt],
      ["Approved locally", draft.approvedAt || "Pending"],
      ["Reason", draft.reason],
      ["Blank counts", "Not counted; excluded from approval"],
      ["Cloud", "Check sync status in the app for server confirmation"],
    ]);
  }
  return new Uint8Array(
    await workbook.xlsx.writeBuffer({
      zip: { compression: "DEFLATE", compressionOptions: { level: 1 } },
    }),
  );
}

function styleSheet(sheet: import("exceljs").Worksheet) {
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
  };
  sheet.getRow(1).height = 28;
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF184D3E" },
  };
  sheet.pageSetup = {
    orientation: "landscape",
    paperSize: 9,
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    printTitlesRow: "1:1",
  };
  sheet.eachRow((row, index) => {
    row.alignment = { vertical: "top", wrapText: true };
    if (index > 1) {
      let lines = 1;
      row.eachCell((cell, column) => {
        const width = Math.max(1, (sheet.getColumn(column).width || 20) - 2);
        lines = Math.max(
          lines,
          ...cell.text
            .split(/\r?\n/)
            .map((line) => Math.ceil(line.length / width)),
        );
      });
      row.height = Math.min(409, Math.max(24, lines * 16 + 8));
    }
    if (index > 1 && index % 2 === 0)
      row.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFF2F5EF" },
      };
  });
}

export async function createExcelReport(
  data: Inventory,
  scope?: string,
): Promise<Uint8Array> {
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  const stock = data.batches.map((b) => {
    const ingredient = ingredients.get(b.ingredientId);
    return {
      Ingredient: ingredient?.name ?? "",
      Batch: b.code,
      Quantity: b.quantity,
      Unit: ingredient?.unit ?? "",
      Received: b.received,
      Expiry: b.expiry,
    };
  });
  const movements = data.movements.map((m) => {
    const ingredient = ingredients.get(m.ingredientId);
    return {
      Date: m.date,
      Ingredient: ingredient?.name ?? "",
      Batch: m.batch,
      Type: m.type,
      Quantity: m.quantity,
      Unit: ingredient?.unit ?? "",
      Reason: m.reason ?? "",
    };
  });
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stockroom";
  workbook.description = scope
    ? `${scope}. Stock quantities are current; dates apply to movements.`
    : "";
  for (const [name, rows, headers] of [
    [
      "Stock",
      stock,
      ["Ingredient", "Batch", "Quantity", "Unit", "Received", "Expiry"],
    ],
    [
      "Movements",
      movements,
      ["Date", "Ingredient", "Batch", "Type", "Quantity", "Unit", "Reason"],
    ],
  ] as const) {
    const sheet = workbook.addWorksheet(name);
    sheet.columns = headers.map((h) => ({
      header: h,
      key: h,
      width: h === "Ingredient" || h === "Reason" ? 36 : h === "Date" ? 28 : 18,
    }));
    sheet.addRows(rows);
    styleSheet(sheet);
    sheet.getColumn(name === "Stock" ? 3 : 5).numFmt =
      "#,##0.###;[Red]-#,##0.###;0";
  }
  if (scope) {
    const info = workbook.addWorksheet("Report");
    info.columns = [{ width: 22 }, { width: 80 }];
    info.addRows([
      ["Stockroom", scope],
      ["Generated", new Date().toLocaleString()],
      ["Stock", "Current quantities"],
      ["Dates", "Apply to movement history"],
    ]);
  }
  return new Uint8Array(
    await workbook.xlsx.writeBuffer({
      zip: { compression: "DEFLATE", compressionOptions: { level: 1 } },
    }),
  );
}
