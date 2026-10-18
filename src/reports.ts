import * as Print from "expo-print";
import { File, Paths } from "expo-file-system";
import { saveToDownloads } from "../modules/stockroom-downloads";
import { createCountReport, createExcelReport } from "./excel";
import { Inventory } from "./inventory";
import { filterReport, ReportFilters } from "./reportFilters";
import type { CountDraft } from "./opname";
import { reportDocument, reportTable } from "./reportHtml";
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
  if (kind === "xlsx")
    return saveReportFile(await createExcelReport(data, scope), kind);
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  const stock = data.batches.map((b) => {
    const i = ingredients.get(b.ingredientId);
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
    const i = ingredients.get(m.ingredientId);
    return {
      Date: new Date(m.date).toLocaleString(),
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
    const result = await Print.printToFileAsync({
      // Use bytes, not the print module's private temporary file URI.
      base64: true,
      width: 842,
      height: 595,
      html: reportDocument(
        "Stockroom",
        `${new Date().toLocaleString()} · ${scope}`,
        `<p>Stock quantities are current. Date filters apply to movement history.</p><h2>Current stock (${stock.length} batches)</h2>${reportTable(stock, ["Ingredient", "Batch", "Quantity", "Unit", "Received", "Expiry"])}<h2>Movements (${movements.length})</h2>${reportTable(movements, ["Date", "Ingredient", "Batch", "Type", "Quantity", "Unit", "Reason"])}`,
      ),
    });
    if (!result.base64) throw Error("Could not generate the PDF file.");
    content = result.base64;
  } else throw Error("Unsupported export format.");
  return saveReportFile(content, kind);
}

export async function exportCount(
  draft: CountDraft,
  kind: "pdf" | "xlsx",
  template = false,
) {
  if (kind === "xlsx")
    return saveReportFile(await createCountReport(draft, template), kind);
  const rows = draft.rows.map((r) => {
    const count = r.count.trim() === "" ? null : Number(r.count);
    if (
      count !== null &&
      (!Number.isFinite(count) ||
        count > 1e12 ||
        !/^\d+(\.\d{1,3})?$/.test(r.count.trim()))
    )
      throw Error(`Check physical count for ${r.name} / ${r.batch}.`);
    return {
      Name: r.name,
      Batch: r.batch,
      System: r.expected,
      Physical: count ?? "Not counted",
      Difference:
        count === null ? "" : Math.round((count - r.expected) * 1000) / 1000,
      Unit: r.unit,
    };
  });
  const result = await Print.printToFileAsync({
    base64: true,
    width: 842,
    height: 595,
    html: reportDocument(
      "Stock opname comparison",
      `${draft.approvedAt ? "Approved locally - check cloud sync status" : "Draft"} · Started ${draft.startedAt} · ${draft.id}`,
      `<p>${escape(draft.reason)}</p>${reportTable(rows, ["Name", "Batch", "System", "Physical", "Difference", "Unit"])}`,
    ),
  });
  if (!result.base64) throw Error("Could not generate PDF.");
  return saveReportFile(result.base64, kind);
}

async function saveReportFile(
  content: string | Uint8Array,
  kind: "pdf" | "xlsx",
) {
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
