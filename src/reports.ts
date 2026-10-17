import * as Print from "expo-print";
import { File, Paths } from "expo-file-system";
import { saveToDownloads } from "../modules/stockroom-downloads";
import { createExcelReport } from "./excel";
import { Inventory } from "./inventory";
import { filterReport, ReportFilters } from "./reportFilters";
const escape = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export async function exportReport(
  source: Inventory,
  kind: "pdf" | "xlsx",
  filters: ReportFilters = {},
) {
  const data = filterReport(source, filters);
  const scope = `${filters.ingredientIds ? data.ingredients.map((i) => i.name).join(", ") : "All ingredients"} · ${filters.from || "All dates"}${filters.to ? ` to ${filters.to}` : ""}`;
  const stock = data.batches.map((b) => {
    const i = data.ingredients.find((i) => i.id === b.ingredientId);
    return {
      Ingredient: i?.name ?? "",
      Batch: b.code,
      Quantity: b.quantity,
      Unit: i?.unit ?? "",
      Received: b.received,
      Expiry: b.expiry,
    };
  });
  const movements = data.movements.map((m) => {
    const i = data.ingredients.find((i) => i.id === m.ingredientId);
    return {
      Date: m.date,
      Ingredient: i?.name ?? "",
      Batch: m.batch,
      Type: m.type,
      Quantity: m.quantity,
      Unit: i?.unit ?? "",
      Reason: m.reason ?? "",
    };
  });
  let content: string | Uint8Array;
  if (kind === "pdf") {
    const table = (rows: Record<string, unknown>[], headers: string[]) =>
      `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${headers.map((h) => `<td>${escape(r[h])}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
    const result = await Print.printToFileAsync({
      // Use bytes, not the print module's private temporary file URI.
      base64: true,
      html: `<html><head><meta charset="utf-8"><style>@page{margin:30px}body{font:11px sans-serif;color:#20382c}h1{font-size:28px}h2{margin-top:30px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px;border-bottom:1px solid #ddd}th{background:#e9efe5}thead{display:table-header-group}tr{page-break-inside:avoid}</style></head><body><h1>Stockroom</h1><p>${escape(new Date().toLocaleString())}</p><p>${escape(scope)}</p><h2>Current stock</h2>${table(stock, ["Ingredient", "Batch", "Quantity", "Unit", "Received", "Expiry"])}<h2>Movements</h2>${table(movements, ["Date", "Ingredient", "Batch", "Type", "Quantity", "Unit", "Reason"])}</body></html>`,
    });
    if (!result.base64) throw Error("Could not generate the PDF file.");
    content = result.base64;
  } else {
    content = await createExcelReport(data, scope);
  }
  const mimeType =
    kind === "pdf"
      ? "application/pdf"
      : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const filename = `stockroom-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${kind}`;
  const file = new File(Paths.cache, filename);
  try {
    await file.write(
      content,
      typeof content === "string" ? { encoding: "base64" } : undefined,
    );
    return await saveToDownloads(file.uri, filename, mimeType);
  } finally {
    try {
      await file.delete();
    } catch {
      /* Cache cleanup must not hide the save result or original error. */
    }
  }
}
