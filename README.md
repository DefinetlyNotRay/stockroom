# Stockroom

Android inventory app built with Expo SDK 58, React Native and TypeScript. Concise, green-and-cream UI with Home, Stock, History and More screens.

## Run on Android

```powershell
npm install
npm start
```

Build and install an Android development client or the preview APK below. Direct report downloads use a local Expo native module and are unavailable in Expo Go. Rebuild the Android app whenever that native module changes.

## Installable APK

```powershell
npx eas-cli@latest login
npx eas-cli@latest build --platform android --profile preview
```

EAS builds and signs the APK remotely; no website hosting is required. Building requires an Expo account. The application identifier is `com.stockroom.inventory`; choose your own before distribution.

## Workflows

- Create ingredients with a stock unit and minimum (up to three decimal places).
- Receive batches with quantities and native calendar pickers for received and expiry dates.
- Use stock automatically in received-date order, preserving each batch's ingredient minimum. A minimum of zero consumes batches completely.
- Manually select a batch to consume its remainder. Expired batches cannot be consumed through either mode. Remaining stock, including expired stock, remains visible until adjusted.
- Corrections require a batch, counted quantity and reason; their signed differences enter the movement history.
- Excel and PDF buttons open export options: all dates or an inclusive date range, plus all ingredients or a multi-selection. Dates filter movement history in the phone's local timezone; stock shows current quantities for the selected ingredients. Excel includes Stock, Movements and Report sheets; PDF labels the selection and current stock. On Android 10+, reports save directly to Downloads with unique filenames, without a folder picker or storage permission. Incomplete downloads and temporary export files are cleaned up after errors. Direct exports require a newly built APK; Android 9 and earlier are unsupported for this export flow.

## Storage and Supabase

Cloud reads use responses of at most 200 ingredients/batches at a time. Stock metadata is combined for accurate totals and FIFO previews; normal refreshes cache only the latest 25 history records. Home shows five recent movements. History and ingredient history fetch 25 movements per page, with search, sorting and local date bounds applied on the server. Stock, batches and ingredient selectors display 25 items per page. Full report history is fetched in chunks of 200 only when exporting. Offline cloud history is limited to the recent cached page; reconnect to browse older records.

Supabase is the shared inventory database when configured. Sign in under More > Account at least once before going offline. Every ingredient, receipt, usage entry, adjustment and minimum change saves to persistent SQLite storage immediately, together with an account-specific sync queue. The app tries syncing after saves and on startup; use **Sync now** when you reconnect. Pending entries survive restarts, and an expired login does not prevent local work. Sign in to the same account again if needed to sync. With no Supabase configuration, the app runs locally.

Sync replays entries in order using stable IDs, so interrupted replies cannot double-count stock. Original entry times and reviewed usage batches are preserved. Conflicting stock counts, minimum edits or unavailable batches stop syncing and keep that entry and subsequent entries on the phone. The pending indicator shows that local stock includes unsynced changes. Retry after resolving the conflict, or explicitly choose **Discard pending changes** under Account to replace all pending local changes with cloud stock; this requires a successful online read first. Sign-out is disabled while entries are pending. Clearing app data or uninstalling removes unsynced entries, so sync before doing either.

While entries are pending, History shows local recent and pending movements. Full cloud reports require syncing first and an internet connection. Browsing older cloud history also requires internet; inventory balances and cached history remain available offline.

The database has `ingredients`, `batches`, `stock_entries`, `stock_movements` and `inventory_requests`. Entries group batch allocations; movements are the quantity ledger. The app cannot directly edit or delete balances or history. PostgreSQL handles FIFO, the switching minimum, expiry exclusion, account isolation, atomic rollback and idempotent retries. Refresh stock under More > Account reloads the account's current records.

To connect the database:

1. Apply the Supabase migrations using the commands in [supabase/README.md](supabase/README.md).
2. In the app, open More > Account > Create an account. Enter an email and matching passwords. If email confirmation is enabled, confirm the email and then sign in. Supabase creates the user ID automatically.
3. Copy `.env.example` to `.env.local` and supply `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` (the publishable key). Never use a service-role key in the app. This workspace already has the supplied project configured locally; the file is ignored by Git.
4. Restart Metro (or rebuild the APK), then sign in under More > Account.
5. If you already entered stock in the local-only version, use Import phone stock once, before creating any cloud ingredients. It preserves existing records, and records an opening adjustment if the local history is incomplete. It requires an empty cloud account and never silently merges or overwrites cloud stock. Original local data remains on the phone.

The earlier `inventory_backups` table remains untouched for compatibility with any existing backups, but the app no longer reads or writes it. Apply all pending migrations with `npm run db:push`; do not reset your hosted database.

## Checks

```powershell
npm run typecheck
npm run lint
node --experimental-strip-types --test tests/*.test.mjs
npx expo export --platform android
npx expo-doctor
```

Phone acceptance checks: sign in; create an ingredient; receive two batches; use an amount spanning both batches; verify the minimum is retained; manually consume a remainder; adjust a counted quantity; inspect the corresponding rows in Supabase; restart the app and check persistence; open both exported reports. Offline, cached stock is readable but cloud writes fail visibly.

Android runtime, keyboard behavior, PDF rendering, share-sheet integration and cloud connectivity require device testing. Metro export verifies compilation, not an installed APK. Dependency audit findings from the generated Expo dependency tree should be reviewed before client distribution; do not force incompatible Expo downgrades suggested by npm audit.

Excel exports use the polyfill-free ExcelJS browser bundle. Do not switch to the default `exceljs` runtime import: its core-js Promise replacement conflicts with the Expo/Hermes runtime. After updating from a build that loaded the default bundle, fully close the app and restart Metro with `npx expo start --clear` before reopening it; Fast Refresh cannot undo changes to runtime globals.


