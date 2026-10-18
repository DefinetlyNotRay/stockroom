import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadReportSnapshot,
  REPORT_PAGE_SIZE,
  reportScope,
} from "../src/reportCache.ts";
const data = {
  ingredients: [{ id: "i", name: "Flour", unit: "kg", threshold: 0 }],
  batches: [
    {
      id: "b",
      ingredientId: "i",
      code: "B",
      quantity: 3,
      received: "2026-01-01",
      expiry: "2099-01-01",
    },
  ],
  movements: Array.from({ length: 4505 }, (_, n) => ({
    id: `m${n}`,
    ingredientId: "i",
    batchId: "b",
    batch: "B",
    quantity: 1,
    type: "received",
    date: "2026-10-01T08:00:00Z",
  })),
};
function harness() {
  const values = new Map();
  const storage = {
    getItem: async (key) => values.get(key) || null,
    setItem: async (key, value) => values.set(key, value),
  };
  const calls = [];
  let active = 0,
    peak = 0,
    revision = "1";
  const read = async (offset, known) => {
    calls.push({ offset, known });
    active++;
    peak = Math.max(active, peak);
    await new Promise((resolve) => setImmediate(resolve));
    active--;
    if (known === revision) return { revision, unchanged: true };
    return {
      revision,
      unchanged: false,
      total: data.movements.length,
      ...Object.fromEntries(
        Object.entries(data).map(([key, rows]) => [
          key,
          rows.slice(offset, offset + REPORT_PAGE_SIZE),
        ]),
      ),
    };
  };
  return {
    values,
    storage,
    read,
    calls,
    peak: () => peak,
    change: () => (revision = "2"),
  };
}
test("large report fetches complete history with bounded parallel pages; later exports reuse persisted data", async () => {
  const h = harness();
  const first = await loadReportSnapshot(h.storage, "a", {}, h.read);
  assert.equal(first.movements.length, 4505);
  assert.deepEqual(
    h.calls.map((c) => c.offset),
    [0, 1000, 2000, 3000, 4000],
  );
  assert.equal(h.peak(), 3);
  const second = await loadReportSnapshot(h.storage, "a", {}, h.read);
  assert.equal(second.movements.length, 4505);
  assert.equal(h.calls.length, 6);
  assert.equal(h.calls.at(-1).known, "1");
  // A full saved report can serve a smaller selection, still after server validation.
  const filtered = await loadReportSnapshot(
    h.storage,
    "a",
    { from: "2026-10-02" },
    h.read,
  );
  assert.equal(filtered.movements.length, 0);
  assert.equal(h.calls.length, 7);
  h.change();
  await loadReportSnapshot(h.storage, "a", {}, h.read);
  assert.equal(h.calls.length, 12);
});
test("different accounts and scopes cannot reuse another saved report", async () => {
  const h = harness();
  await loadReportSnapshot(h.storage, "a", { from: "2026-10-01" }, h.read);
  await loadReportSnapshot(h.storage, "b", {}, h.read);
  assert.equal(h.calls[5].known, undefined);
  await loadReportSnapshot(h.storage, "a", { from: "2026-09-01" }, h.read);
  assert.equal(h.calls[10].known, undefined);
  assert.notEqual(reportScope({}), reportScope({ ingredientIds: ["i"] }));
  assert.equal(
    reportScope({ ingredientIds: ["a", "b"] }),
    reportScope({ ingredientIds: ["b", "a"] }),
  );
});
test("failed or inconsistent pages never replace a complete saved report", async () => {
  const h = harness();
  await loadReportSnapshot(h.storage, "a", {}, h.read);
  const original = h.values.get("stockroom-report-v1:a");
  h.change();
  await assert.rejects(
    loadReportSnapshot(h.storage, "a", {}, async (offset, known) => {
      const page = await h.read(offset, known);
      return offset ? { ...page, revision: "3" } : page;
    }),
    /Stock changed/,
  );
  assert.equal(h.values.get("stockroom-report-v1:a"), original);
  await assert.rejects(
    loadReportSnapshot(h.storage, "a", {}, async (offset, known) => {
      if (offset) throw Error("Network failed");
      return h.read(offset, known);
    }),
    /Network failed/,
  );
  assert.equal(h.values.get("stockroom-report-v1:a"), original);
});
test("corrupt cache and cache write errors do not prevent a fresh complete export", async () => {
  const h = harness();
  h.values.set("stockroom-report-v1:a", "invalid JSON");
  const result = await loadReportSnapshot(
    {
      ...h.storage,
      setItem: async () => {
        throw Error("Disk full");
      },
    },
    "a",
    {},
    h.read,
  );
  assert.equal(result.movements.length, 4505);
});
