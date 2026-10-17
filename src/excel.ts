// The default ExcelJS browser bundle installs core-js globally. Its Promise
// replacement conflicts with Expo/Hermes. Always use the polyfill-free bundle.
import ExcelJS from "exceljs/dist/exceljs.bare.min.js";
import type { Inventory } from "./inventory";

export async function createExcelReport(
  data: Inventory,
  scope?: string,
): Promise<Uint8Array> {
  const stock = data.batches.map((b) => {
    const ingredient = data.ingredients.find((i) => i.id === b.ingredientId);
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
    const ingredient = data.ingredients.find((i) => i.id === m.ingredientId);
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
      width: h === "Date" ? 28 : 20,
    }));
    sheet.addRows([...rows]);
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF184D3E" },
    };
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
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
