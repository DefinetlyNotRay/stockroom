import { amount, round, uid } from "./inventory.ts";
import type { Inventory } from "./inventory";

export type CountRow = {
  batchId: string;
  name: string;
  batch: string;
  unit: string;
  expected: number;
  count: string;
};
export type CountDraft = {
  id: string;
  startedAt: string;
  approvedAt?: string;
  reason: string;
  rows: CountRow[];
};
export function startCount(data: Inventory): CountDraft {
  const ingredients = new Map(data.ingredients.map((i) => [i.id, i]));
  return {
    id: uid(),
    startedAt: new Date().toISOString(),
    reason: "Stock opname",
    rows: data.batches.map((b) => ({
      batchId: b.id,
      name: ingredients.get(b.ingredientId)!.name,
      batch: b.code,
      unit: ingredients.get(b.ingredientId)!.unit,
      expected: b.quantity,
      count: "",
    })),
  };
}
export function countEntries(draft: CountDraft, data: Inventory) {
  if (draft.approvedAt) throw Error("This count has already been approved.");
  if (!draft.reason.trim()) throw Error("Enter an adjustment reason.");
  const batches = new Map(data.batches.map((b) => [b.id, b]));
  const counted = draft.rows.filter((r) => r.count.trim() !== "");
  if (!counted.length)
    throw Error("Enter or import at least one physical count.");
  return counted.map((r) => {
    const quantity = amount(r.count, true);
    const b = batches.get(r.batchId);
    if (!b || b.quantity !== r.expected)
      throw Error(
        `Stock changed for ${r.name} / ${r.batch}. Review and refresh its system quantity first.`,
      );
    return {
      batchId: r.batchId,
      ingredientId: b.ingredientId,
      expectedQuantity: r.expected,
      quantity,
    };
  });
}
export function applyCount(
  draft: CountDraft,
  data: Inventory,
  occurredAt: string,
): Inventory {
  const entries = countEntries(draft, data);
  const changes = new Map(entries.map((e) => [e.batchId, e]));
  return {
    ...data,
    batches: data.batches.map((b) => ({
      ...b,
      quantity: changes.get(b.id)?.quantity ?? b.quantity,
    })),
    movements: [
      ...entries
        .filter((e) => e.quantity !== e.expectedQuantity)
        .map((e) => ({
          id: `${draft.id}:${e.batchId}`,
          ingredientId: e.ingredientId,
          batchId: e.batchId,
          batch: data.batches.find((b) => b.id === e.batchId)!.code,
          quantity: round(e.quantity - e.expectedQuantity),
          type: "adjusted" as const,
          date: occurredAt,
          reason: `${draft.reason.trim()} [${draft.id}]`,
        })),
      ...data.movements,
    ],
  };
}

const normalize = (value: string) => value.trim().toLowerCase();
// Validate the complete file before merging any row into the draft.
export function mergeCounts(
  draft: CountDraft,
  rows: { name: string; batch: string; count: string; row: number }[],
): CountDraft {
  const lookup = new Map<string, CountRow[]>();
  const key = (name: string, batch: string) =>
    JSON.stringify([normalize(name), normalize(batch)]);
  for (const row of draft.rows) {
    const k = key(row.name, row.batch);
    lookup.set(k, [...(lookup.get(k) || []), row]);
  }
  const updates = new Map<string, string>();
  const seen = new Set<string>();
  for (const row of rows) {
    const matches = lookup.get(key(row.name, row.batch));
    if (!matches || matches.length !== 1)
      throw Error(
        `Row ${row.row}: name and batch must match exactly one existing batch (${row.name} / ${row.batch}).`,
      );
    const id = matches[0].batchId;
    if (seen.has(id)) throw Error(`Row ${row.row}: duplicate name and batch.`);
    seen.add(id);
    if (!row.count.trim()) continue;
    try {
      updates.set(id, String(amount(row.count, true)));
    } catch {
      throw Error(
        `Row ${row.row}: physical count must be a non-negative number with up to 3 decimals.`,
      );
    }
  }
  if (!updates.size) throw Error("The file contains no physical counts.");
  return {
    ...draft,
    rows: draft.rows.map((r) =>
      updates.has(r.batchId) ? { ...r, count: updates.get(r.batchId)! } : r,
    ),
  };
}
