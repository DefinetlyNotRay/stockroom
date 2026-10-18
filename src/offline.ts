import { emptyInventory, parseInventory } from "./inventory";
import type { Inventory } from "./inventory";
import type { StockCommand } from "./cloud";

export type PendingCommand = StockCommand & { occurredAt: string };
export type OfflineRecord = {
  version: number;
  inventory: Inventory;
  pending: PendingCommand[];
};
type Store = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
};

// One SQLite value commits the visible stock and its outbox together.
export function createOfflineStore(storage: Store) {
  const locks = new Map<string, Promise<unknown>>();
  const syncs = new Map<string, Promise<OfflineRecord>>();
  const key = (owner: string) => `stockroom-offline-v1:${owner}`;
  async function load(owner: string): Promise<OfflineRecord> {
    const raw = await storage.getItem(key(owner));
    if (raw) {
      const record = JSON.parse(raw) as OfflineRecord;
      if (
        !Number.isSafeInteger(record.version) ||
        record.version < 0 ||
        !Array.isArray(record.pending)
      )
        throw Error(
          "Could not read the saved sync queue. Do not clear app data.",
        );
      if (
        record.pending.some(
          (item) =>
            !item ||
            typeof item.id !== "string" ||
            !item.id ||
            ![
              "ingredient",
              "settings",
              "receive",
              "use",
              "adjust",
              "opname",
            ].includes(item.kind) ||
            !item.data ||
            typeof item.data !== "object" ||
            Array.isArray(item.data) ||
            typeof item.occurredAt !== "string" ||
            !Number.isFinite(Date.parse(item.occurredAt)),
        ) ||
        new Set(record.pending.map((item) => item.id)).size !==
          record.pending.length
      )
        throw Error(
          "Could not read the saved sync queue. Do not clear app data.",
        );
      parseInventory(record.inventory);
      return record;
    }
    const legacy = await storage.getItem(`stockroom-account:${owner}`);
    const inventory = legacy
      ? parseInventory(JSON.parse(legacy))
      : emptyInventory;
    return { version: 0, inventory, pending: [] };
  }
  function locked<T>(owner: string, action: () => Promise<T>): Promise<T> {
    const result = (locks.get(owner) || Promise.resolve())
      .catch(() => {})
      .then(action);
    locks.set(owner, result);
    return result;
  }
  async function persist(owner: string, record: OfflineRecord) {
    await storage.setItem(key(owner), JSON.stringify(record));
    return record;
  }
  async function enqueue(
    owner: string,
    command: PendingCommand,
    inventory: Inventory,
    version: number,
    baseInventory?: Inventory,
  ) {
    return locked(owner, async () => {
      const record = await load(owner);
      const existing = record.pending.find((item) => item.id === command.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(command))
          throw Error("Entry ID is already queued. Reopen this form.");
        return record;
      }
      if (
        record.version !== version &&
        (!baseInventory ||
          JSON.stringify(record.inventory) !== JSON.stringify(baseInventory))
      )
        throw Error(
          "Stock changed during sync. Review this entry and save again.",
        );
      parseInventory(inventory);
      return persist(owner, {
        version: record.version + 1,
        inventory,
        pending: [...record.pending, command],
      });
    });
  }
  function sync(
    owner: string,
    send: (command: PendingCommand) => Promise<void>,
    readRemote: () => Promise<Inventory>,
  ): Promise<OfflineRecord> {
    const running = syncs.get(owner);
    if (running) return running;
    const operation = (async () => {
      while (true) {
        const snapshot = await locked(owner, () => load(owner));
        const command = snapshot.pending[0];
        if (!command) break;
        // Send one at a time. The server deduplicates IDs after interrupted replies.
        await send(command);
        await locked(owner, async () => {
          const current = await load(owner);
          if (current.pending[0]?.id !== command.id)
            throw Error("Sync queue changed unexpectedly.");
          await persist(owner, {
            ...current,
            version: current.version + 1,
            pending: current.pending.slice(1),
          });
        });
      }
      const snapshot = await locked(owner, () => load(owner));
      const remote = await readRemote();
      return locked(owner, async () => {
        const current = await load(owner);
        // An entry may have been saved while the remote pages were loading.
        if (current.version !== snapshot.version || current.pending.length)
          return current;
        return persist(owner, {
          version: current.version + 1,
          inventory: remote,
          pending: [],
        });
      });
    })();
    syncs.set(owner, operation);
    void operation.finally(() => syncs.delete(owner)).catch(() => {});
    return operation;
  }
  async function discardPending(
    owner: string,
    readRemote: () => Promise<Inventory>,
  ) {
    if (syncs.has(owner)) throw Error("Wait for sync to finish first.");
    const snapshot = await locked(owner, () => load(owner));
    const inventory = await readRemote();
    return locked(owner, async () => {
      const current = await load(owner);
      if (syncs.has(owner) || current.version !== snapshot.version)
        throw Error("Stock changed. Review pending entries again.");
      return persist(owner, {
        version: current.version + 1,
        inventory,
        pending: [],
      });
    });
  }
  return { load, enqueue, sync, discardPending };
}
