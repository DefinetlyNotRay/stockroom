import "react-native-url-polyfill/auto";
import { createClient } from "@supabase/supabase-js";
import Storage from "expo-sqlite/kv-store";
import { Inventory, Movement, parseInventory } from "./inventory";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key =
  process.env.EXPO_PUBLIC_SUPABASE_KEY ||
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const fetchWithTimeout: typeof fetch = async (input, init) => {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (init?.signal?.aborted) cancel();
  init?.signal?.addEventListener("abort", cancel);
  const timer = setTimeout(cancel, 12000);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    init?.signal?.removeEventListener("abort", cancel);
  }
};
export const cloud =
  url && key
    ? createClient(url, key, {
        global: { fetch: fetchWithTimeout },
        auth: {
          storage: Storage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;
export const HISTORY_PAGE_SIZE = 25;
export type HistoryQuery = {
  page?: number;
  ingredientId?: string;
  search?: string;
  from?: string;
  to?: string;
  oldest?: boolean;
};
export async function readHistoryPage(
  query: HistoryQuery = {},
  limit = HISTORY_PAGE_SIZE + 1,
): Promise<Movement[]> {
  if (!cloud) throw Error("Supabase is not configured.");
  const start = (day: string, next = false) => {
    const date = new Date(`${day}T00:00:00`);
    if (next) date.setDate(date.getDate() + 1);
    return date.toISOString();
  };
  const { data, error } = await cloud.rpc("inventory_history_page", {
    p_offset: (query.page || 0) * HISTORY_PAGE_SIZE,
    p_limit: limit,
    p_ingredient: query.ingredientId || null,
    p_search: query.search || "",
    p_from: query.from ? start(query.from) : null,
    p_to: query.to ? start(query.to, true) : null,
    p_oldest: query.oldest || false,
  });
  if (error) throw Error(error.message);
  return data as Movement[];
}
export async function readInventory(
  allHistory = false,
  expectedOwner?: string,
): Promise<Inventory> {
  if (!cloud) throw Error("Supabase is not configured.");
  const {
    data: { user },
    error: authError,
  } = await cloud.auth.getUser();
  if (authError || !user) throw Error("Sign in first.");
  if (expectedOwner && user.id !== expectedOwner)
    throw Error("Account changed. Refresh stock.");
  const ensureOwner = async () => {
    const {
      data: { session },
    } = await cloud!.auth.getSession();
    if (session?.user.id !== user.id)
      throw Error("Account changed. Refresh stock.");
  };
  const inventory: Inventory = { ingredients: [], batches: [], movements: [] };
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await cloud.rpc("inventory_page", {
      p_offset: offset,
      p_limit: 200,
    });
    if (error) throw Error(error.message);
    await ensureOwner();
    inventory.ingredients.push(...data.ingredients);
    inventory.batches.push(...data.batches);
    if (data.ingredients.length < 200 && data.batches.length < 200) break;
  }
  if (allHistory) {
    for (let page = 0; ; page += 8) {
      const rows = await readHistoryPage({ page }, 200);
      await ensureOwner();
      inventory.movements.push(...rows);
      if (rows.length < 200) break;
    }
  } else inventory.movements = await readHistoryPage({}, HISTORY_PAGE_SIZE);
  await ensureOwner();
  return parseInventory(inventory);
}
export type StockCommand = {
  id: string;
  kind: "ingredient" | "settings" | "receive" | "use" | "adjust";
  data: Record<string, unknown>;
};
export async function pushOfflineCommand(
  owner: string,
  command: StockCommand & { occurredAt: string },
): Promise<void> {
  if (!cloud) throw Error("Supabase is not configured.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const { error } = await cloud
      .rpc("inventory_sync_command", {
        p_owner: owner,
        p_id: command.id,
        p_kind: command.kind,
        p_data: command.data,
        p_occurred_at: command.occurredAt,
      })
      .abortSignal(controller.signal);
    if (error) throw Error(error.message);
  } finally {
    clearTimeout(timer);
  }
}
export async function importPhoneInventory(): Promise<void> {
  if (!cloud) throw Error("Supabase is not configured.");
  const raw = await Storage.getItem("stockroom-v1");
  if (!raw) throw Error("No existing phone stock to import.");
  const inventory = parseInventory(JSON.parse(raw));
  if (!inventory.ingredients.length)
    throw Error("No existing phone stock to import.");
  const { error } = await cloud.rpc("inventory_import_paged", {
    p_inventory: inventory,
  });
  if (error) throw new Error(error.message);
}
export async function executeCommand(
  command: StockCommand,
): Promise<Inventory> {
  if (!cloud) throw Error("Supabase is not configured.");
  const { error } = await cloud.rpc("inventory_command_paged", {
    p_id: command.id,
    p_kind: command.kind,
    p_data: command.data,
  });
  if (error) throw error;
  return readInventory();
}
