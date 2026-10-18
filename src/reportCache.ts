import { parseInventory } from "./inventory.ts";
import type { Inventory } from "./inventory";
import { filterReport, type ReportFilters } from "./reportFilters.ts";

export type ReportPage = Partial<Inventory> & {
  revision: string;
  unchanged: boolean;
  total?: number;
};
type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};
type Snapshot = { scope: string; revision: string; data: Inventory };
export const REPORT_PAGE_SIZE = 1000;
export const REPORT_CONCURRENCY = 3;
export function reportScope(filters: ReportFilters) {
  // Include actual date boundaries: a timezone change must not reuse another day's report.
  const start = filters.from
    ? new Date(`${filters.from}T00:00:00`).toISOString()
    : "";
  const end = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
  end?.setDate(end.getDate() + 1);
  return JSON.stringify([
    filters.ingredientIds ? [...new Set(filters.ingredientIds)].sort() : null,
    start,
    end?.toISOString() || "",
  ]);
}
export async function loadReportSnapshot(
  storage: Store,
  owner: string,
  filters: ReportFilters,
  readPage: (offset: number, knownRevision?: string) => Promise<ReportPage>,
): Promise<Inventory> {
  const key = `stockroom-report-v1:${owner}`;
  const scope = reportScope(filters);
  let cached: Snapshot | null = null;
  try {
    const raw = await storage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as Snapshot;
      if (
        (saved.scope === scope || saved.scope === reportScope({})) &&
        typeof saved.revision === "string"
      ) {
        parseInventory(saved.data);
        cached = saved;
      }
    }
  } catch {
    /* A disposable report copy must not prevent a fresh export. */
  }
  const first = await readPage(0, cached?.revision);
  if (first.unchanged) {
    if (!cached || first.revision !== cached.revision)
      throw Error("Invalid saved report version. Try exporting again.");
    return filterReport(cached.data, filters);
  }
  if (
    !Number.isSafeInteger(first.total) ||
    first.total! < 0 ||
    typeof first.revision !== "string"
  )
    throw Error("Invalid report response.");
  const data: Inventory = { ingredients: [], batches: [], movements: [] };
  function append(page: ReportPage, offset: number) {
    if (page.unchanged || page.revision !== first.revision)
      throw Error("Stock changed while loading the report. Export again.");
    for (const table of ["ingredients", "batches", "movements"] as const) {
      const rows = page[table];
      if (!Array.isArray(rows) || rows.length > REPORT_PAGE_SIZE)
        throw Error("Incomplete report response.");
      if (
        offset + REPORT_PAGE_SIZE < first.total! &&
        Math.max(
          page.ingredients?.length || 0,
          page.batches?.length || 0,
          page.movements?.length || 0,
        ) !== REPORT_PAGE_SIZE
      )
        throw Error("Incomplete report response.");
    }
    data.ingredients.push(...page.ingredients!);
    data.batches.push(...page.batches!);
    data.movements.push(...page.movements!);
  }
  append(first, 0);
  for (
    let offset = REPORT_PAGE_SIZE;
    offset < first.total!;
    offset += REPORT_PAGE_SIZE * REPORT_CONCURRENCY
  ) {
    const offsets = Array.from(
      { length: REPORT_CONCURRENCY },
      (_, n) => offset + n * REPORT_PAGE_SIZE,
    ).filter((n) => n < first.total!);
    const pages = await Promise.all(offsets.map((n) => readPage(n)));
    pages.forEach((page, n) => append(page, offsets[n]));
  }
  if (
    Math.max(
      data.ingredients.length,
      data.batches.length,
      data.movements.length,
    ) !== first.total
  )
    throw Error("Incomplete report response.");
  for (const rows of [data.ingredients, data.batches, data.movements])
    if (new Set(rows.map((r) => r.id)).size !== rows.length)
      throw Error("Report contains duplicate records. Export again.");
  parseInventory(data);
  // One saved snapshot per account bounds storage and serves both Excel and PDF.
  try {
    await storage.setItem(
      key,
      JSON.stringify({ scope, revision: first.revision, data }),
    );
  } catch {
    /* Export still works when the report copy cannot be saved. */
  }
  return filterReport(data, filters);
}
