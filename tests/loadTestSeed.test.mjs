import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

test("load-test seed is additive, repeatable and reconciles balances with history", async () => {
  const db = new PGlite();
  const actor = "50445eb6-e717-4a70-b9fb-bc3b71ea96c6";
  try {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      insert into auth.users values('${actor}');`);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort()) {
      await db.exec(readFileSync(new URL(file, dir), "utf8"));
    }
    await db.query(
      "insert into public.ingredients(user_id,id,name,unit) values($1,'existing','Real stock','kg')",
      [actor],
    );
    const seed = readFileSync(
      new URL("../supabase/seeds/load-test.sql", import.meta.url),
      "utf8",
    );
    await db.exec(seed);
    await db.exec(seed);
    const { rows } = await db.query(`select
      (select count(*)::int from ingredients) as ingredients,
      (select count(*)::int from batches) as batches,
      (select count(*)::int from stock_entries) as entries,
      (select count(*)::int from stock_movements) as movements,
      (select count(*)::int from batches b where b.quantity<>(select sum(m.quantity) from stock_movements m where m.user_id=b.user_id and m.batch_id=b.id)) as mismatches,
      (select count(*)::int from ingredients where id='existing' and name='Real stock') as preserved`);
    assert.deepEqual(rows[0], {
      ingredients: 301,
      batches: 1800,
      entries: 14400,
      movements: 14400,
      mismatches: 0,
      preserved: 1,
    });
    await db.exec(`set "request.jwt.claim.sub"='${actor}';`);
    const inventory = (await db.query("select inventory_read() as data"))
      .rows[0].data;
    assert.equal(inventory.ingredients.length, 301);
    assert.equal(inventory.movements.length, 14400);
    assert.ok(inventory.batches.some((b) => b.quantity === 0));
    assert.ok(inventory.movements.some((m) => m.type === "adjusted"));
    // Exercise the actual paginated endpoints against the large dataset.
    await db.exec(
      "grant usage on schema public,auth to authenticated; set role authenticated;",
    );
    const page = async (offset, oldest = false) =>
      (
        await db.query(
          "select inventory_history_page($1,26,null,'',null,null,$2) as data",
          [offset, oldest],
        )
      ).rows[0].data;
    const first = await page(0);
    const second = await page(25);
    assert.equal(first.length, 26);
    assert.equal(second.length, 26);
    assert.equal(first[25].id, second[0].id); // lookahead does not skip a row
    assert.equal(
      new Set([...first.slice(0, 25), ...second.slice(0, 25)].map((m) => m.id))
        .size,
      50,
    );
    const oldest = await page(0, true);
    assert.ok(Date.parse(oldest[0].date) <= Date.parse(oldest[24].date));
    assert.ok(Date.parse(first[0].date) >= Date.parse(first[24].date));
    const scoped = (
      await db.query(
        "select inventory_history_page(0,26,'stockroom-loadtest-v1-ingredient-1','rice',null,null,false) as data",
      )
    ).rows[0].data;
    assert.ok(scoped.length > 0);
    assert.ok(
      scoped.every(
        (m) => m.ingredientId === "stockroom-loadtest-v1-ingredient-1",
      ),
    );
    const noMatches = (
      await db.query(
        "select inventory_history_page(0,26,null,'does-not-exist',null,null,false) as data",
      )
    ).rows[0].data;
    assert.equal(noMatches.length, 0);
    const metadata = (await db.query("select inventory_page(0,99999) as data"))
      .rows[0].data;
    assert.equal(metadata.ingredients.length, 200);
    assert.equal(metadata.batches.length, 200);
    const ack = (
      await db.query(
        `select inventory_command_paged('paged-command','ingredient','{"name":"Paged command","unit":"kg","threshold":0}') as data`,
      )
    ).rows[0].data;
    assert.deepEqual(ack, {});
    await db.exec(
      `set "request.jwt.claim.sub"='00000000-0000-0000-0000-000000000002';`,
    );
    assert.equal((await page(0)).length, 0);
    assert.deepEqual(
      (await db.query("select inventory_page() as data")).rows[0].data,
      { ingredients: [], batches: [] },
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query("select inventory_history_page()"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
