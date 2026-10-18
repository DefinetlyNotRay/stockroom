import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
test("report pages filter on server, version changes, and respect account permissions", async () => {
  const db = new PGlite();
  const a = "00000000-0000-0000-0000-000000000001";
  const b = "00000000-0000-0000-0000-000000000002";
  try {
    await db.exec(`create role anon;create role authenticated;create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      grant usage on schema public,auth to authenticated,anon;
      insert into auth.users values('${a}'),('${b}');`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((name) => name.endsWith(".sql"))
      .sort())
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    for (const [owner, id] of [
      [a, "i"],
      [a, "j"],
      [b, "private"],
    ]) {
      await db.query(
        "insert into ingredients(user_id,id,name,unit) values($1,$2,$2,'kg')",
        [owner, id],
      );
      await db.query(
        "insert into batches(user_id,id,ingredient_id,code,received_date,expiry_date,quantity) values($1,$2,$2,$2,'2026-01-01','2099-01-01',1)",
        [owner, id],
      );
      await db.query(
        "insert into stock_entries(user_id,id,ingredient_id,kind,quantity,created_at) values($1,$2,$2,'received',1,'2026-10-01T08:00:00Z')",
        [owner, id],
      );
      await db.query(
        "insert into stock_movements(user_id,id,entry_id,ingredient_id,batch_id,quantity,created_at) values($1,$2,$2,$2,$2,1,'2026-10-01T08:00:00Z')",
        [owner, id],
      );
    }
    await db.exec(`set role authenticated;set "request.jwt.claim.sub"='${a}';`);
    const read = async ({
      offset = 0,
      limit = 1000,
      ids = null,
      from = null,
      to = null,
      revision = null,
    } = {}) =>
      (
        await db.query(
          "select inventory_report_page($1,$2,$3::text[],$4::timestamptz,$5::timestamptz,$6) as data",
          [offset, limit, ids, from, to, revision],
        )
      ).rows[0].data;
    const full = await read();
    assert.equal(full.total, 2);
    assert.deepEqual(
      full.ingredients.map((i) => i.id),
      ["i", "j"],
    );
    assert.equal(full.movements.length, 2);
    const cached = await read({ revision: full.revision });
    assert.equal(cached.unchanged, true);
    assert.equal(cached.movements, undefined);
    const selected = await read({
      ids: ["i"],
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-02T00:00:00Z",
    });
    assert.equal(selected.total, 1);
    assert.equal(selected.movements[0].ingredientId, "i");
    assert.equal(selected.batches.length, 1);
    const emptyDates = await read({ from: "2026-10-02T00:00:00Z" });
    assert.equal(emptyDates.movements.length, 0);
    assert.equal(emptyDates.batches.length, 2);
    const page1 = await read({ limit: 1 });
    const page2 = await read({ limit: 1, offset: 1 });
    assert.equal(page1.total, 2);
    assert.notEqual(page1.movements[0].id, page2.movements[0].id);
    assert.equal((await read({ ids: ["private"] })).ingredients.length, 0);
    await assert.rejects(
      db.query("update inventory_report_versions set revision=0"),
      /permission denied/,
    );
    // Backdated changes must invalidate even when they fall outside recent history.
    await db.exec(
      `reset role;update stock_movements set created_at='2025-01-01' where user_id='${a}' and id='i';set role authenticated;`,
    );
    const changed = await read({ revision: full.revision });
    assert.equal(changed.unchanged, false);
    assert.notEqual(changed.revision, full.revision);
    // Another account's change doesn't invalidate this account's saved reports.
    await db.exec(
      `reset role;update batches set quantity=2 where user_id='${b}';set role authenticated;`,
    );
    assert.equal((await read({ revision: changed.revision })).unchanged, true);
    await db.exec(`set role anon;`);
    await assert.rejects(read(), /permission denied/);
  } finally {
    await db.close();
  }
});
