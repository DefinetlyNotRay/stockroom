# Database migrations

The migrations create a normalized inventory database:

| Table                | Records                                            |
| -------------------- | -------------------------------------------------- |
| `ingredients`        | Name, stock unit and FIFO switching minimum        |
| `batches`            | Ingredient, batch code, dates and current quantity |
| `stock_entries`      | Receipts, usage and adjustments, including reasons |
| `stock_movements`    | Signed batch allocations belonging to each entry   |
| `inventory_requests` | Operation IDs and payloads for safe retries        |

Foreign keys keep records within one account. Indexes support ingredient lookup, FIFO ordering, expiry and history. Row-level security isolates accounts; the app has read access and executes mutations through `inventory_command`, not direct table writes. That function locks operations per account, allocates FIFO on the server, prevents overspending, and commits history and balances together. `inventory_read` fetches records for the app; `inventory_import` transfers legacy phone data into an empty account once.

The original migration creates a legacy `inventory_backups` table. It is retained without deleting existing data, but the current app does not use it. Run every migration in chronological order; do not edit previously applied migrations.

## Apply to the supplied Supabase project

From the repository root:

```powershell
npm run db:login
npm run db:link
npm run db:plan
npm run db:push
```

Login opens Supabase CLI authentication. Link targets `vgghkiccerzmxvtqewsd` and may prompt for the project's database password. Plan displays pending migrations without applying them; push applies them and records their versions. These commands use the locally installed CLI and do not require Docker for a hosted project.

The app's publishable key cannot create database tables. CLI authentication and project access are required. Do not place management credentials in any `EXPO_PUBLIC_*` variable.

After applying, open More > Account > Create an account in the app. Register with an email and password; confirm the email if required, then sign in. Supabase Auth creates the user ID. Create an ingredient and receive a batch; inspect `ingredients`, `batches`, `stock_entries` and `stock_movements` in the dashboard to verify persistence. Existing local-only phone stock can be transferred with Import phone stock before adding any cloud ingredients.

Alternatively, run each migration file in chronological order in the dashboard SQL Editor. If you later adopt the CLI after applying SQL manually, link the project and mark each successfully applied version using `npx supabase migration repair --status applied <version>`. Prefer CLI setup from the beginning to track migration history automatically.

## Load-test data

`seeds/load-test.sql` adds 300 mock ingredients, 1,800 batches and 14,400 movements to the explicitly named test account. Names start with `MOCK ·` and IDs with `stockroom-loadtest-v1-`. Existing stock is preserved; rerunning the seed leaves the dataset unchanged. It includes empty, low-stock, expired and soon-expiring batches, with historical receipts, usage and physical-count adjustments that reconcile to current balances.

Run deliberately with `npx supabase db query --linked --file supabase/seeds/load-test.sql`, then refresh inventory in More > Account. This seed is separate from migrations and never runs on app startup. Validate it locally with `node --test tests/loadTestSeed.test.mjs`.

## Future migrations

The offline-sync migration adds `inventory_sync_command`, bound to the authenticated account and an explicit owner ID. It preserves original timestamps, validates reviewed batch allocations, rejects conflicting counts/minimum changes and reuses the existing per-account lock and request deduplication. `inventory_apply_offline` is a private helper with no client execute grant. It accepts past operation dates only through the validated wrapper; existing online endpoints are unchanged. Validate with `node --test tests/offline.test.mjs tests/offlineDatabase.test.mjs`.

```powershell
npx supabase migration new describe_the_change
```

Edit the new SQL file under `supabase/migrations`, review it with `npm run db:plan`, then apply it with `npm run db:push`. Keep applied migration files unchanged; add a new migration for subsequent changes.

## Verification

The pagination migration adds `inventory_page`, `inventory_history_page`, `inventory_command_paged` and `inventory_import_paged`. Legacy endpoints remain available for older APKs. New command/import endpoints preserve the existing transaction and retry rules while returning a small acknowledgement instead of the full inventory. Reads retain row-level account isolation. Run `node --test tests/cloudPagination.test.mjs tests/loadTestSeed.test.mjs` to check bounded reads, filters, page boundaries, account changes, complete exports and seeded data reconciliation.

```powershell
npm run db:status
```

The PostgreSQL integration tests run without Docker using PGlite. They apply every migration to a fresh database with stand-in Supabase Auth roles and test FIFO, rollback, retries, adjustments, expired batches, isolation, import, and reconciliation:

```powershell
node --experimental-strip-types --test tests/database.test.mjs
```

These tests exercise SQL and privileges but do not replace hosted Auth/PostgREST or real concurrent connection checks. Full local Supabase development and the original backup pgTAP tests require Docker:

```powershell
npx supabase start
npx supabase db reset --local
npx supabase test db
```

Reset here targets the disposable local development database. Do not use reset against the hosted project.
