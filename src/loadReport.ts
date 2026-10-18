import Storage from "expo-sqlite/kv-store";
import { cloud } from "./cloud";
import {
  loadReportSnapshot,
  REPORT_PAGE_SIZE,
  type ReportPage,
} from "./reportCache";
import type { ReportFilters } from "./reportFilters";

export async function loadCloudReport(owner: string, filters: ReportFilters) {
  if (!cloud) throw Error("Supabase is not configured.");
  const client = cloud;
  const ensureOwner = async () => {
    const {
      data: { session },
    } = await client.auth.getSession();
    if (session?.user.id !== owner)
      throw Error("Account changed. Reopen the export.");
  };
  await ensureOwner();
  const from = filters.from
    ? new Date(`${filters.from}T00:00:00`).toISOString()
    : null;
  const to = filters.to ? new Date(`${filters.to}T00:00:00`) : null;
  to?.setDate(to.getDate() + 1);
  const result = await loadReportSnapshot(
    Storage,
    owner,
    filters,
    async (offset, knownRevision) => {
      await ensureOwner();
      const { data, error } = await client.rpc("inventory_report_page", {
        p_offset: offset,
        p_limit: REPORT_PAGE_SIZE,
        p_ingredients: filters.ingredientIds || null,
        p_from: from,
        p_to: to?.toISOString() || null,
        p_known_revision: knownRevision || null,
      });
      if (error) {
        if (error.code === "PGRST202")
          throw Error(
            "Update the Stockroom database to enable faster exports.",
          );
        throw Error(error.message);
      }
      await ensureOwner();
      return data as ReportPage;
    },
  );
  await ensureOwner();
  return result;
}
