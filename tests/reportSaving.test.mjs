import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { filterReport } from "../src/reportFilters.ts";
const compiled = ts.transpileModule(
  readFileSync(new URL("../src/reports.ts", import.meta.url), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  },
).outputText;
const target =
  "content://media/external/downloads/42";
const pdfBytes = Buffer.from("%PDF-1.7\nstockroom");
const empty = { ingredients: [], batches: [], movements: [] };
function harness({
  missingPdf = false,
  failWrite = false,
  saveError = null,
  failCleanup = false,
} = {}) {
  const files = [];
  const dialogs = [];
  const created = [];
  class File {
    constructor() {
      this.uri = "file:///cache/report";
      this.finished = false;
      files.push(this);
    }
    async write(content, options) {
      await new Promise((resolve) => setImmediate(resolve));
      if (failWrite) throw Error("Disk full");
      this.bytes =
        options?.encoding === "base64"
          ? Buffer.from(content, "base64")
          : Buffer.from(content);
      this.finished = true;
    }
    async delete() {
      if (failCleanup) throw Error("Cleanup failed");
      this.deleted = true;
    }
  }
  const modules = {
    "expo-print": {
      printToFileAsync: async (options) => ({
        uri: "file:///private/Print/inaccessible.pdf",
        ...(options.base64 && !missingPdf
          ? { base64: pdfBytes.toString("base64") }
          : {}),
      }),
    },
    "expo-file-system": {
      File,
      Paths: { cache: "file:///cache" },
    },
    "../modules/stockroom-downloads": {
      saveToDownloads: async (uri, name, mimeType) => {
        assert.equal(uri, files[0].uri);
        assert.equal(files[0].finished, true);
        if (saveError) throw saveError;
        created.push({ name, mimeType });
        return target;
      },
    },
    "./excel": {
      createExcelReport: async () => new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
    },
    "./reportFilters": { filterReport },
  };
  const context = vm.createContext({
    exports: {},
    require: (name) => {
      if (!(name in modules)) throw Error("Unexpected dependency " + name);
      return modules[name];
    },
  });
  vm.runInContext(compiled, context);
  return {
    exportReport: context.exports.exportReport,
    files,
    dialogs,
    created,
  };
}
test("PDF saves complete bytes directly to Downloads and cleans up cache", async () => {
  const app = harness();
  assert.equal(await app.exportReport(empty, "pdf"), target);
  assert.equal(app.created[0].mimeType, "application/pdf");
  assert.ok(app.created[0].name.endsWith(".pdf"));
  assert.deepEqual(app.files[0].bytes, pdfBytes);
  assert.equal(app.files[0].finished, true);
  assert.equal(app.files[0].deleted, true);
  assert.equal(app.dialogs.length, 0);
});
test("Excel saves the workbook with the correct filename and MIME type", async () => {
  const app = harness();
  assert.equal(await app.exportReport(empty, "xlsx"), target);
  assert.equal(
    app.created[0].mimeType,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.ok(app.created[0].name.endsWith(".xlsx"));
  assert.deepEqual([...app.files[0].bytes], [0x50, 0x4b, 0x03, 0x04]);
  assert.equal(app.files[0].finished, true);
});
test("Downloads failures propagate and clean up cache", async () => {
  const app = harness({ saveError: Error("Storage unavailable") });
  await assert.rejects(app.exportReport(empty, "pdf"), /Storage unavailable/);
  assert.equal(app.files[0].deleted, true);
});
test("cache cleanup failures do not turn a completed save into an error", async () => {
  const app = harness({ failCleanup: true });
  assert.equal(await app.exportReport(empty, "pdf"), target);
});
test("failed generation never creates an empty destination document", async () => {
  const app = harness({ missingPdf: true });
  await assert.rejects(app.exportReport(empty, "pdf"), /Could not generate/);
  assert.equal(app.dialogs.length, 0);
  assert.equal(app.files.length, 0);
});
test("failed writes propagate the error and clean up the incomplete document", async () => {
  const app = harness({ failWrite: true });
  await assert.rejects(app.exportReport(empty, "xlsx"), /Disk full/);
  assert.equal(app.files[0].finished, false);
  assert.equal(app.files[0].deleted, true);
  assert.equal(app.created.length, 0);
});
