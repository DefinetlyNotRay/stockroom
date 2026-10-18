import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { loadReportSnapshot, REPORT_PAGE_SIZE } from "../src/reportCache.ts";
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/loadReport.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
function harness({ switchAccount = false, error = null } = {}) {
  let owner = "a";
  const values = new Map(),
    calls = [];
  const modules = {
    "expo-sqlite/kv-store": {
      getItem: async (key) => values.get(key) || null,
      setItem: async (key, value) => values.set(key, value),
    },
    "./cloud": {
      cloud: {
        auth: {
          getSession: async () => ({
            data: { session: { user: { id: owner } } },
          }),
        },
        rpc: async (name, args) => {
          calls.push({ name, args });
          if (switchAccount) owner = "b";
          return {
            error,
            data:
              args.p_known_revision === "1"
                ? { revision: "1", unchanged: true }
                : {
                    revision: "1",
                    unchanged: false,
                    total: 2,
                    ingredients: ["i", "j"].map((id) => ({ id, name: id, unit: "kg", threshold: 0 })),
                    batches: [],
                    movements: [],
                  },
          };
        },
      },
    },
    "./reportCache": { loadReportSnapshot, REPORT_PAGE_SIZE },
  };
  const context = vm.createContext({
    exports: {},
    require: (name) => modules[name],
  });
  vm.runInContext(compiled, context);
  return { load: context.exports.loadCloudReport, calls };
}
test("export forwards selection and local date boundaries and reuses its report across formats", async () => {
  const h = harness();
  const filters = {
    ingredientIds: ["i", "j"],
    from: "2026-10-01",
    to: "2026-10-18",
  };
  await h.load("a", filters);
  assert.equal(h.calls[0].name, "inventory_report_page");
  const args = h.calls[0].args;
  assert.equal(args.p_limit, 1000);
  assert.deepEqual(args.p_ingredients, filters.ingredientIds);
  assert.equal(args.p_from, new Date("2026-10-01T00:00:00").toISOString());
  assert.equal(args.p_to, new Date("2026-10-19T00:00:00").toISOString());
  await h.load("a", filters);
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1].args.p_known_revision, "1");
});
test("account switches and server failures never return an export", async () => {
  await assert.rejects(
    harness({ switchAccount: true }).load("a", {}),
    /Account changed/,
  );
  await assert.rejects(
    harness({ error: { message: "Connection lost" } }).load("a", {}),
    /Connection lost/,
  );
});
