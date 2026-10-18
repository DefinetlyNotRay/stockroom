import React, { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
import Storage from "expo-sqlite/kv-store";
import { Ionicons } from "@expo/vector-icons";
import {
  allocate,
  amount,
  Batch,
  emptyInventory,
  Ingredient,
  Inventory,
  move,
  parseInventory,
  round,
  today,
  uid,
  validDate,
} from "./inventory";
import ExportSheet from "./ExportSheet";
import { loadCloudReport } from "./loadReport";
import StockOpname from "./StockOpname";
import { applyCount, countEntries, type CountDraft } from "./opname";
import CloudPanel from "./CloudPanel";
import DateField from "./DateField";
import IngredientDropdown from "./IngredientDropdown";
import PagedList, { PageControls } from "./PagedList";
import useHistoryPage from "./useHistoryPage";
import {
  cloud,
  readInventory,
  pushOfflineCommand,
  StockCommand,
} from "./cloud";
import { offlineStorage } from "./offlineStorage";
import type { OfflineRecord } from "./offline";
import { router, useLocalSearchParams } from "expo-router";

type Tab = "Home" | "Stock" | "History" | "More";
type Form = "ingredient" | "receive" | "use" | "adjust" | "settings" | null;
const tabs: { name: Tab; icon: keyof typeof Ionicons.glyphMap }[] = [
  { name: "Home", icon: "grid-outline" },
  { name: "Stock", icon: "cube-outline" },
  { name: "History", icon: "time-outline" },
  { name: "More", icon: "ellipsis-horizontal" },
];
const fmt = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: 3 });
function Button({
  title,
  onPress,
  secondary = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.button,
        secondary && s.secondary,
        (disabled || pressed) && { opacity: 0.55 },
      ]}
    >
      <Text style={[s.buttonText, secondary && { color: C.green }]}>
        {title}
      </Text>
    </Pressable>
  );
}
function Field({
  label,
  value,
  onChange,
  numeric = false,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        style={s.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor="#000000"
        keyboardType={numeric ? "decimal-pad" : "default"}
        autoCapitalize="none"
      />
    </View>
  );
}
const C = {
  green: "#184D3E",
  ink: "#202E28",
  muted: "#778078",
  bg: "#F6F5F0",
  line: "#E4E7DE",
  amber: "#94601B",
};
export default function AppScreen() {
  const [data, setData] = useState<Inventory>(emptyInventory);
  const live = useRef(data);
  const [ready, setReady] = useState(false);
  const params = useLocalSearchParams<{
    tab?: Tab;
    ingredient?: string;
    opname?: string;
  }>();
  const tab = tabs.some((t) => t.name === params.tab) ? params.tab! : "Home";
  const setTab = (v: Tab) => router.setParams({ tab: v });
  const [search, setSearch] = useState("");
  const [historyOrder, setHistoryOrder] = useState<"newest" | "oldest">(
    "newest",
  );
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const selected = params.ingredient || null;
  const setSelected = (v: string | null) =>
    router.setParams({ ingredient: v || "" });
  const [form, setForm] = useState<Form>(null);
  const [exportKind, setExportKind] = useState<"pdf" | "xlsx" | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const storeVersion = useRef(0);
  const syncingOwner = useRef<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const requestId = useRef(uid());
  const [account, setAccount] = useState<string | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const activeAccount = useRef<string | null>(null);
  const [connectionError, setConnectionError] = useState("");
  const [ingredientId, setIngredientId] = useState("");
  const [batchId, setBatchId] = useState("");
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("kg");
  const [minimum, setMinimum] = useState("0");
  const [quantity, setQuantity] = useState("");
  const [code, setCode] = useState("");
  const [received, setReceived] = useState(today());
  const [expiry, setExpiry] = useState("");
  const [reason, setReason] = useState("");
  const [manual, setManual] = useState(false);
  const [review, setReview] = useState<
    { batchId: string; quantity: number }[] | null
  >(null);
  const historyPage = useHistoryPage({
    account,
    active: ready && pendingCount === 0 && (!!selected || tab === "History"),
    ingredientId: selected,
    search: tab === "History" && !selected ? search : "",
    from: tab === "History" && !selected ? historyFrom : "",
    to: tab === "History" && !selected ? historyTo : "",
    oldest: tab === "History" && !selected && historyOrder === "oldest",
    revision: data,
  });
  const refreshAfterLoad = useEffectEvent(refreshInventory);
  useEffect(() => {
    if (!cloud) return;
    let cancelled = false;
    void Storage.getItem("stockroom-last-account")
      .then((owner) => {
        if (!cancelled && owner && !activeAccount.current) {
          activeAccount.current = owner;
          setReady(false);
          setAccount(owner);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (selected) {
        router.setParams({ ingredient: "" });
        return true;
      }
      if (tab !== "Home") {
        router.setParams({ tab: "Home" });
        return true;
      }
      return false;
    });
    return () => listener.remove();
  }, [selected, tab]);
  useEffect(() => {
    if (cloud) {
      const {
        data: { subscription },
      } = cloud.auth.onAuthStateChange((_event, session) => {
        const id = session?.user.id || null;
        setAuthenticated(!!id);
        // An expired online session must not lock the user out of local work.
        // Explicit sign-out clears this workspace through onSignOut below.
        if (!id) return;
        void Storage.setItem("stockroom-last-account", id).catch(() => {});
        if (id !== activeAccount.current) {
          setReady(false);
          setData(emptyInventory);
          live.current = emptyInventory;
          setConnectionError("");
          setForm(null);
          setExportKind(null);
          storeVersion.current = 0;
          setPendingCount(0);
        }
        activeAccount.current = id;
        setAccount(id);
      });
      return () => subscription.unsubscribe();
    }
  }, []);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (account) return offlineStorage.load(account);
      const raw = await Storage.getItem("stockroom-v1");
      return {
        version: 0,
        pending: [],
        inventory: raw ? parseInventory(JSON.parse(raw)) : emptyInventory,
      };
    };
    load()
      .then((record) => {
        if (cancelled) return;
        storeVersion.current = record.version;
        setPendingCount(record.pending.length);
        setData(record.inventory);
        live.current = record.inventory;
        setReady(true);
        if (account)
          void refreshAfterLoad().catch((e) => {
            if (!cancelled)
              setConnectionError(
                e instanceof Error ? e.message : "Could not refresh stock.",
              );
          });
      })
      .catch(() => {
        if (cancelled) return;
        setReady(true);
        setConnectionError("Could not read cached stock.");
        if (account)
          void refreshAfterLoad().catch((e) =>
            setConnectionError(
              e instanceof Error ? e.message : "Could not load stock.",
            ),
          );
      });
    return () => {
      cancelled = true;
    };
    // refreshInventory reads the active account and guards against account switches.
  }, [account]);
  async function commit(next: Inventory) {
    await Storage.setItem(
      account ? `stockroom-account:${account}` : "stockroom-v1",
      JSON.stringify(next),
    );
    live.current = next;
    setData(next);
  }
  async function approveCount(draft: CountDraft) {
    if (saving.current) throw Error("Wait for the current save to finish.");
    if (cloud && !account) throw Error("Sign in under More first.");
    saving.current = true;
    setBusy(true);
    const owner = account;
    try {
      const before = live.current;
      const occurredAt = new Date().toISOString();
      // Recover if the app closed after the inventory save but before the draft update.
      const existing = before.movements.find(
        (m) =>
          m.id.startsWith(`${draft.id}:`) ||
          m.reason?.endsWith(`[${draft.id}]`),
      );
      if (existing) return existing.date;
      const entries = countEntries(draft, before);
      const next = applyCount(draft, before, occurredAt);
      if (owner) {
        const record = await offlineStorage.enqueue(
          owner,
          {
            id: draft.id,
            kind: "opname",
            occurredAt,
            data: { entries, reason: draft.reason.trim() },
          },
          next,
          storeVersion.current,
          before,
        );
        if (activeAccount.current !== owner)
          throw Error("Account changed. Count saved to the original account.");
        applyOfflineRecord(owner, record);
        setTimeout(() => {
          if (activeAccount.current === owner)
            void refreshInventory().catch(showSyncError);
        }, 0);
      } else await commit(next);
      return occurredAt;
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  async function refreshInventory() {
    if (saving.current) return;
    const owner = activeAccount.current;
    if (!owner) throw Error("Sign in first.");
    if (syncingOwner.current === owner) return;
    syncingOwner.current = owner;
    setSyncing(true);
    try {
      const record = await offlineStorage.sync(
        owner,
        async (command) => {
          if (activeAccount.current !== owner)
            throw Error("Account changed. Pending entries remain saved.");
          await pushOfflineCommand(owner, command);
        },
        async () => {
          if (activeAccount.current !== owner) throw Error("Account changed.");
          return readInventory(false, owner);
        },
      );
      applyOfflineRecord(owner, record);
      if (activeAccount.current === owner) setConnectionError("");
      if (record.pending.length && activeAccount.current === owner)
        setTimeout(() => {
          void refreshInventory().catch(showSyncError);
        }, 0);
    } catch (error) {
      // Some entries may have synced before a network failure or conflict.
      const record = await offlineStorage.load(owner);
      applyOfflineRecord(owner, record);
      throw error;
    } finally {
      if (syncingOwner.current === owner) {
        syncingOwner.current = null;
        setSyncing(false);
      }
    }
  }
  function applyOfflineRecord(owner: string, record: OfflineRecord) {
    if (
      activeAccount.current !== owner ||
      record.version < storeVersion.current
    )
      return;
    storeVersion.current = record.version;
    live.current = record.inventory;
    setData(record.inventory);
    setPendingCount(record.pending.length);
  }
  function showSyncError(error: unknown) {
    setConnectionError(
      error instanceof Error
        ? error.message
        : "Could not sync. Entries remain saved on this phone.",
    );
  }
  const ingredient = data.ingredients.find((i) => i.id === ingredientId);
  const detail = data.ingredients.find((i) => i.id === selected);
  const total = (id: string) =>
    round(
      data.batches
        .filter((b) => b.ingredientId === id)
        .reduce((n, b) => n + b.quantity, 0),
    );
  const active = data.batches.filter((b) => b.quantity > 0);
  const soon = new Date();
  soon.setDate(soon.getDate() + 7);
  const soonDate = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, "0")}-${String(soon.getDate()).padStart(2, "0")}`;
  const expiring = active.filter(
    (b) => b.expiry >= today() && b.expiry <= soonDate,
  );
  const expired = active.filter((b) => b.expiry < today());
  function open(next: Form, id?: string) {
    requestId.current = uid();
    setForm(next);
    setError("");
    setIngredientId(id || data.ingredients[0]?.id || "");
    setBatchId("");
    setName("");
    setUnit("kg");
    setMinimum(
      String(data.ingredients.find((i) => i.id === id)?.threshold || 0),
    );
    setQuantity("");
    setCode("");
    setReceived(today());
    setExpiry("");
    setReason("");
    setManual(false);
    setReview(null);
  }
  async function save() {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      if (cloud && !account) throw Error("Sign in under More first.");
      const baseVersion = storeVersion.current;
      const before = live.current;
      let next = before;
      const item = next.ingredients.find((i) => i.id === ingredientId);
      if (form === "ingredient") {
        if (!name.trim() || !unit.trim()) throw Error("Enter a name and unit.");
        if (
          next.ingredients.some(
            (i) => i.name.toLowerCase() === name.trim().toLowerCase(),
          )
        )
          throw Error("Ingredient already exists.");
        next = {
          ...next,
          ingredients: [
            ...next.ingredients,
            {
              id: requestId.current,
              name: name.trim(),
              unit: unit.trim(),
              threshold: amount(minimum, true),
            },
          ],
        };
      } else {
        if (!item) throw Error("Choose an ingredient.");
        if (form === "settings") {
          const threshold = amount(minimum, true);
          next = {
            ...next,
            ingredients: next.ingredients.map((i) =>
              i.id === item.id ? { ...i, threshold } : i,
            ),
          };
        }
        if (form === "receive") {
          const q = amount(quantity);
          if (!code.trim()) throw Error("Enter a batch number.");
          if (!validDate(received) || !validDate(expiry))
            throw Error("Use valid dates: YYYY-MM-DD.");
          if (received > today() || expiry < received)
            throw Error("Check the received and expiry dates.");
          if (
            next.batches.some(
              (b) =>
                b.ingredientId === item.id &&
                b.code.toLowerCase() === code.trim().toLowerCase(),
            )
          )
            throw Error("Batch already exists.");
          const batch: Batch = {
            id: requestId.current,
            ingredientId: item.id,
            code: code.trim(),
            received,
            expiry,
            quantity: 0,
          };
          next = move(
            { ...next, batches: [...next.batches, batch] },
            item.id,
            [{ batchId: batch.id, quantity: q }],
            "received",
          );
        }
        if (form === "use") {
          const allocations = allocate(
            next,
            item,
            amount(quantity),
            manual ? batchId : undefined,
          );
          if (manual && !batchId) throw Error("Choose a batch.");
          if (
            !review ||
            JSON.stringify(review) !== JSON.stringify(allocations)
          ) {
            setReview(allocations);
            return;
          }
          next = move(
            next,
            item.id,
            allocations.map((a) => ({ ...a, quantity: -a.quantity })),
            "used",
          );
        }
        if (form === "adjust") {
          const b = next.batches.find(
            (b) => b.id === batchId && b.ingredientId === item.id,
          );
          if (!b) throw Error("Choose a batch.");
          if (!reason.trim()) throw Error("Enter a reason.");
          const diff = round(amount(quantity, true) - b.quantity);
          if (!diff) throw Error("Quantity is unchanged.");
          next = move(
            next,
            item.id,
            [{ batchId: b.id, quantity: diff }],
            "adjusted",
            reason.trim(),
          );
        }
      }
      if (cloud) {
        const owner = account;
        const kind = form as StockCommand["kind"];
        const payload: Record<string, unknown> = {
          ingredientId,
          today: today(),
          expectedThreshold: item?.threshold,
        };
        if (kind === "ingredient") {
          payload.name = name.trim();
          payload.unit = unit.trim();
          payload.threshold = amount(minimum, true);
        } else if (kind === "settings")
          payload.threshold = amount(minimum, true);
        else {
          payload.quantity = amount(quantity, kind === "adjust");
          if (kind === "receive") {
            payload.code = code.trim();
            payload.received = received;
            payload.expiry = expiry;
          }
          if (kind === "use") {
            payload.batchId = manual ? batchId : null;
            payload.allocations = allocate(
              before,
              item!,
              amount(quantity),
              manual ? batchId : undefined,
            );
          }
          if (kind === "adjust") {
            payload.batchId = batchId;
            payload.reason = reason.trim();
            payload.expectedQuantity = before.batches.find(
              (b) => b.id === batchId,
            )?.quantity;
          }
        }
        const result = await offlineStorage.enqueue(
          owner!,
          {
            id: requestId.current,
            kind,
            data: payload,
            occurredAt:
              next.movements.find(
                (m) => !before.movements.some((old) => old.id === m.id),
              )?.date || new Date().toISOString(),
          },
          next,
          baseVersion,
          before,
        );
        if (activeAccount.current !== owner)
          throw Error("Account changed. Refresh stock.");
        applyOfflineRecord(owner!, result);
        setConnectionError("");
        setTimeout(() => {
          if (activeAccount.current === owner)
            void refreshInventory().catch(showSyncError);
        }, 0);
      } else await commit(next);
      setForm(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save. Try again.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  function movementRows(limit?: number) {
    const requested =
      !!account && pendingCount === 0 && (!!selected || tab === "History");
    const remote = requested && !historyPage.error;
    if (requested && historyPage.loading)
      return <ActivityIndicator color={C.green} />;
    const errorNotice =
      requested && historyPage.error ? (
        <View style={s.card}>
          <Text accessibilityRole="alert">{historyPage.error}</Text>
          <Text style={s.small}>Showing recent saved activity.</Text>
          <Button title="Retry history" onPress={historyPage.retry} />
        </View>
      ) : null;
    if (requested && historyPage.error && historyPage.page > 0)
      return (
        <>
          {errorNotice}
          <PageControls
            page={historyPage.page}
            hasNext={false}
            onChange={historyPage.setPage}
          />
        </>
      );
    const history = !limit && tab === "History";
    const entries = (remote ? historyPage.rows : data.movements)
      .filter(
        (m) =>
          (!selected || m.ingredientId === selected) &&
          (!search ||
            data.ingredients
              .find((i) => i.id === m.ingredientId)
              ?.name.toLowerCase()
              .includes(search.toLowerCase())),
      )
      .filter((m) => {
        if (!history) return true;
        const date = new Date(m.date);
        const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        return (
          (!historyFrom || key >= historyFrom) &&
          (!historyTo || key <= historyTo)
        );
      })
      .sort((a, b) => {
        const difference = Date.parse(b.date) - Date.parse(a.date);
        return history && historyOrder === "oldest" ? -difference : difference;
      });
    if (history && !entries.length)
      return (
        <View style={s.empty}>
          {errorNotice}
          <Text style={s.small}>No matching activity.</Text>
          {remote && (
            <PageControls
              page={historyPage.page}
              hasNext={false}
              onChange={historyPage.setPage}
            />
          )}
        </View>
      );
    const renderMovement = (m: Inventory["movements"][number]) => {
      const i = data.ingredients.find((i) => i.id === m.ingredientId);
      return (
        <View key={m.id} style={s.movement}>
          <View
            style={[
              s.moveIcon,
              { backgroundColor: m.type === "used" ? "#F7EBDD" : "#E9EFE6" },
            ]}
          >
            <Ionicons
              name={
                m.type === "received"
                  ? "arrow-down"
                  : m.type === "used"
                    ? "arrow-up"
                    : "swap-horizontal"
              }
              size={19}
              color={C.green}
            />
          </View>
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.rowTitle}>{i?.name}</Text>
            <Text style={s.small}>
              {m.batch} ·{" "}
              {new Date(m.date).toLocaleString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
            <Text style={s.small}>
              {m.type === "received"
                ? "Received"
                : m.type === "used"
                  ? "Used"
                  : "Adjusted"}
              {m.reason ? ` · ${m.reason}` : ""}
            </Text>
          </View>
          <Text
            style={[s.quantity, { color: m.quantity < 0 ? C.amber : C.green }]}
          >
            {m.quantity > 0 ? "+" : ""}
            {fmt(m.quantity)} <Text style={s.small}>{i?.unit}</Text>
          </Text>
        </View>
      );
    };
    if (remote)
      return (
        <>
          {entries.map(renderMovement)}
          <PageControls
            page={historyPage.page}
            hasNext={historyPage.hasNext}
            busy={historyPage.loading}
            onChange={historyPage.setPage}
          />
        </>
      );
    return (
      <>
        {errorNotice}
        {limit ? (
          entries.slice(0, limit).map(renderMovement)
        ) : (
          <PagedList
            items={entries}
            resetKey={`${search}:${historyFrom}:${historyTo}:${historyOrder}:${selected}`}
            renderItem={renderMovement}
          />
        )}
      </>
    );
  }
  function batchRows(i: Ingredient) {
    return (
      <PagedList
        resetKey={i.id}
        items={data.batches
          .filter((b) => b.ingredientId === i.id)
          .sort((a, b) => a.received.localeCompare(b.received))}
        renderItem={(b) => (
          <View key={b.id} style={s.card}>
            <View style={s.between}>
              <Text style={s.rowTitle}>{b.code}</Text>
              <Text style={s.quantity}>
                {fmt(b.quantity)} <Text style={s.small}>{i.unit}</Text>
              </Text>
            </View>
            <View style={[s.between, { marginTop: 12 }]}>
              <Text style={s.small}>In · {b.received}</Text>
              <Text
                style={[s.small, b.expiry < today() && { color: "#B44435" }]}
              >
                Exp · {b.expiry}
              </Text>
            </View>
          </View>
        )}
      />
    );
  }
  if (!ready)
    return (
      <SafeAreaView
        style={[s.safe, { justifyContent: "center", alignItems: "center" }]}
      >
        {error ? <Text>{error}</Text> : <ActivityIndicator color={C.green} />}
      </SafeAreaView>
    );
  return (
    <SafeAreaView style={s.safe}>
      <StatusBar style="dark" />
      <View style={s.header}>
        <View>
          <Text style={s.eyebrow}>STOCKROOM</Text>
          <Text style={s.title}>
            {detail ? detail.name : tab === "Home" ? "A little order." : tab}
          </Text>
        </View>
        <Pressable
          accessibilityLabel={detail ? "Back" : "Add ingredient"}
          style={s.headerIcon}
          onPress={() => (detail ? setSelected(null) : open("ingredient"))}
        >
          <Ionicons
            name={detail ? "arrow-back" : "add"}
            size={25}
            color={C.green}
          />
        </Pressable>
      </View>
      <ScrollView
        key={selected ? `ingredient:${selected}` : tab}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
      >
        {!!connectionError && (
          <Text accessibilityRole="alert" style={{ color: "#AF3E32" }}>
            {connectionError}
          </Text>
        )}
        {detail ? (
          <>
            <View style={s.hero}>
              <Text style={s.heroLabel}>ON HAND</Text>
              <Text style={s.heroNumber}>
                {fmt(total(detail.id))}{" "}
                <Text style={{ fontSize: 24 }}>{detail.unit}</Text>
              </Text>
              <Pressable
                onPress={() => open("settings", detail.id)}
                style={{ paddingVertical: 12 }}
              >
                <Text style={s.heroLabel}>
                  Minimum · {fmt(detail.threshold)} {detail.unit} ⚙
                </Text>
              </Pressable>
            </View>
            <View style={s.actions}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Receive"
                  onPress={() => open("receive", detail.id)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Use stock"
                  secondary
                  onPress={() => open("use", detail.id)}
                />
              </View>
            </View>
            <View style={s.between}>
              <Text style={s.section}>Batches</Text>
              <Pressable
                style={{ padding: 12 }}
                onPress={() => open("adjust", detail.id)}
              >
                <Text style={s.link}>Adjust stock</Text>
              </Pressable>
            </View>
            {batchRows(detail)}
            <Text style={s.section}>History</Text>
            {movementRows(15)}
          </>
        ) : tab === "Home" ? (
          <>
            <View style={s.hero}>
              <View style={s.between}>
                <Text style={s.heroLabel}>YOUR INVENTORY</Text>
                <Ionicons name="layers-outline" color="#C9DCC5" size={25} />
              </View>
              <Text style={s.heroNumber}>
                {data.ingredients.length}
                <Text style={{ fontSize: 22, color: "#C9DCC5" }}>
                  {" "}
                  ingredients
                </Text>
              </Text>
              <View style={s.heroFooter}>
                <Text style={s.heroLabel}>{active.length} active batches</Text>
                <View style={s.localBadge}>
                  <View style={s.dot} />
                  <Text style={{ fontSize: 12, color: "#D5E8CF" }}>
                    Stockroom
                  </Text>
                </View>
              </View>
            </View>
            <View style={s.actions}>
              <Pressable
                style={s.action}
                onPress={() =>
                  open(data.ingredients.length ? "receive" : "ingredient")
                }
              >
                <Ionicons name="arrow-down-outline" size={26} color={C.green} />
                <Text style={s.actionText}>Receive stock</Text>
              </Pressable>
              <Pressable
                style={[s.action, { backgroundColor: "#E4EBD9" }]}
                onPress={() =>
                  open(data.ingredients.length ? "use" : "ingredient")
                }
              >
                <Ionicons name="arrow-up-outline" size={26} color={C.green} />
                <Text style={s.actionText}>Use stock</Text>
              </Pressable>
            </View>
            {(expiring.length > 0 || expired.length > 0) && (
              <View style={s.warning}>
                <Ionicons
                  name="alert-circle-outline"
                  color={C.amber}
                  size={22}
                />
                <Text style={{ color: C.amber, flex: 1 }}>
                  {expired.length > 0
                    ? `${expired.length} expired`
                    : `${expiring.length} expiring soon`}
                </Text>
                <Pressable
                  accessibilityLabel="View stock"
                  onPress={() => setTab("Stock")}
                  style={{ padding: 12 }}
                >
                  <Ionicons name="arrow-forward" size={20} color={C.amber} />
                </Pressable>
              </View>
            )}
            <View style={s.between}>
              <Text style={s.section}>Recent activity</Text>
              <Pressable
                onPress={() => setTab("History")}
                style={{ padding: 12 }}
              >
                <Text style={s.link}>View all</Text>
              </Pressable>
            </View>
            {data.movements.length ? (
              movementRows(5)
            ) : (
              <View style={s.empty}>
                <Ionicons name="leaf-outline" size={42} color={C.green} />
                <Text style={s.emptyTitle}>Room to grow.</Text>
                <Text style={s.small}>
                  Add your first ingredient to get started.
                </Text>
                <Button
                  title="Add ingredient"
                  onPress={() => open("ingredient")}
                />
              </View>
            )}
          </>
        ) : tab === "Stock" ? (
          <>
            <TextInput
              accessibilityLabel="Search ingredients"
              placeholder="Search ingredients"
              placeholderTextColor="#000000"
              value={search}
              onChangeText={setSearch}
              style={s.search}
            />
            <View style={s.between}>
              <Text style={s.small}>{data.ingredients.length} ingredients</Text>
              <Pressable
                style={{ padding: 12 }}
                onPress={() => open("ingredient")}
              >
                <Text style={s.link}>+ Add new</Text>
              </Pressable>
            </View>
            <PagedList
              resetKey={search}
              items={data.ingredients.filter((i) =>
                i.name.toLowerCase().includes(search.toLowerCase()),
              )}
              renderItem={(i) => {
                const batches = data.batches.filter(
                  (b) => b.ingredientId === i.id && b.quantity > 0,
                );
                const expiry = batches.map((b) => b.expiry).sort()[0];
                return (
                  <Pressable
                    key={i.id}
                    style={s.stockRow}
                    onPress={() => setSelected(i.id)}
                  >
                    <View style={s.ingredientIcon}>
                      <Ionicons name="cube-outline" size={24} color={C.green} />
                    </View>
                    <View style={{ flex: 1, gap: 6 }}>
                      <Text style={s.rowTitle}>{i.name}</Text>
                      <Text
                        style={[
                          s.small,
                          expiry && expiry < today()
                            ? { color: "#B44435" }
                            : undefined,
                        ]}
                      >
                        {batches.length} batches
                        {expiry ? ` · Exp ${expiry}` : ""}
                      </Text>
                    </View>
                    <Text style={s.quantity}>
                      {fmt(total(i.id))}
                      <Text style={s.small}> {i.unit}</Text>
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={C.muted}
                    />
                  </Pressable>
                );
              }}
            />
            {!data.ingredients.length && (
              <Text style={s.emptyTitle}>Your stock starts here.</Text>
            )}
          </>
        ) : tab === "History" ? (
          <>
            <TextInput
              style={s.search}
              placeholder="Search ingredients"
              placeholderTextColor="#000000"
              accessibilityLabel="Search history"
              value={search}
              onChangeText={setSearch}
            />
            <View style={s.actions}>
              {(["newest", "oldest"] as const).map((order) => (
                <Pressable
                  key={order}
                  accessibilityRole="button"
                  accessibilityState={{ selected: historyOrder === order }}
                  onPress={() => setHistoryOrder(order)}
                  style={[
                    s.chip,
                    { flex: 1, alignItems: "center" },
                    historyOrder === order && s.selectedChip,
                  ]}
                >
                  <Text
                    style={
                      historyOrder === order ? s.selectedChipText : s.chipText
                    }
                  >
                    {order === "newest" ? "Newest first" : "Oldest first"}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={s.actions}>
              <View style={{ flex: 1 }}>
                <DateField
                  label="From"
                  value={historyFrom}
                  onChange={setHistoryFrom}
                  maximum={historyTo || undefined}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DateField
                  label="To"
                  value={historyTo}
                  onChange={setHistoryTo}
                  minimum={historyFrom || undefined}
                />
              </View>
            </View>
            {!!(historyFrom || historyTo) && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setHistoryFrom("");
                  setHistoryTo("");
                }}
                style={{
                  minHeight: 48,
                  justifyContent: "center",
                  alignSelf: "flex-end",
                  paddingHorizontal: 12,
                }}
              >
                <Text style={s.link}>Clear dates</Text>
              </Pressable>
            )}
            {movementRows()}
          </>
        ) : (
          <>
            <Text style={s.section}>Stock opname</Text>
            <View style={s.card}>
              <Text style={[s.small, { marginBottom: 16 }]}>
                Import physical counts, compare batches, and approve adjustments
                together.
              </Text>
              <Button
                title="Open saved count"
                onPress={() => router.setParams({ opname: "1" })}
                disabled={busy}
              />
            </View>
            <Text style={s.section}>Reports</Text>
            <View style={s.card}>
              <Text style={[s.rowTitle, { marginBottom: 18 }]}>
                Stock & movement history
              </Text>
              <View style={s.actions}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Excel"
                    disabled={busy}
                    onPress={() => setExportKind("xlsx")}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="PDF"
                    secondary
                    disabled={busy}
                    onPress={() => setExportKind("pdf")}
                  />
                </View>
              </View>
            </View>
            <Text style={s.section}>Storage</Text>
            <View style={s.card}>
              <View style={s.between}>
                <Text style={s.rowTitle}>This device</Text>
                <Ionicons
                  name="phone-portrait-outline"
                  size={23}
                  color={C.green}
                />
              </View>
              <Text style={[s.small, { marginTop: 12 }]}>
                {account
                  ? "Saved on this phone · syncs with Supabase"
                  : cloud
                    ? "Sign in to save stock online."
                    : "Saved on this phone."}
              </Text>
            </View>
            <Text style={s.section}>Account</Text>
            <View style={s.card}>
              <CloudPanel
                account={account}
                authenticated={authenticated}
                onRefresh={refreshInventory}
                pendingCount={pendingCount}
                syncing={syncing}
                onSignOut={async () => {
                  const { error } = await cloud!.auth.signOut();
                  if (error) throw error;
                  await Storage.removeItem("stockroom-last-account");
                  activeAccount.current = null;
                  storeVersion.current = 0;
                  setPendingCount(0);
                  setData(emptyInventory);
                  live.current = emptyInventory;
                  setReady(false);
                  setAccount(null);
                  setAuthenticated(false);
                }}
                onDiscardPending={async () => {
                  const owner = activeAccount.current;
                  if (!owner) throw Error("Sign in first.");
                  const record = await offlineStorage.discardPending(
                    owner,
                    () => readInventory(false, owner),
                  );
                  applyOfflineRecord(owner, record);
                  if (activeAccount.current === owner) setConnectionError("");
                }}
              />
            </View>
            <Text style={[s.eyebrow, { marginTop: 32 }]}>STOCKROOM / 01</Text>
          </>
        )}
      </ScrollView>
      <View style={s.nav}>
        {tabs.map((t) => (
          <Pressable
            accessibilityRole="tab"
            accessibilityState={{ selected: tab === t.name && !selected }}
            key={t.name}
            onPress={() => {
              setTab(t.name);
              setSelected(null);
              setSearch("");
            }}
            style={s.navItem}
          >
            <View
              style={[
                s.navPill,
                tab === t.name && !selected && { backgroundColor: "#DFE8D5" },
              ]}
            >
              <Ionicons
                name={t.icon}
                size={23}
                color={tab === t.name ? C.green : C.muted}
              />
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: tab === t.name ? "700" : "400",
                  color: tab === t.name ? C.green : C.muted,
                }}
              >
                {t.name}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      {ready && (
        <StockOpname
          key={account || "local"}
          owner={account || "local"}
          data={data}
          visible={params.opname === "1"}
          onClose={() => router.setParams({ opname: "" })}
          onApprove={approveCount}
        />
      )}
      {exportKind && (
        <ExportSheet
          data={data}
          loadData={
            account
              ? async (filters) => {
                  if ((await offlineStorage.load(account)).pending.length)
                    throw Error(
                      "Sync pending entries before exporting a complete cloud report.",
                    );
                  const snapshot = await loadCloudReport(account, filters);
                  if (activeAccount.current !== account)
                    throw Error("Account changed. Reopen the export.");
                  if ((await offlineStorage.load(account)).pending.length)
                    throw Error(
                      "Stock changed. Sync pending entries before exporting.",
                    );
                  return snapshot;
                }
              : undefined
          }
          kind={exportKind}
          onClose={() => setExportKind(null)}
        />
      )}
      <Modal
        visible={!!form}
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setForm(null);
        }}
      >
        <SafeAreaView style={s.safe}>
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <View style={s.header}>
              <Text style={[s.title, { fontSize: 27 }]}>
                {form === "ingredient"
                  ? "New ingredient"
                  : form === "receive"
                    ? "Receive stock"
                    : form === "use"
                      ? "Use stock"
                      : form === "settings"
                        ? "Ingredient settings"
                        : "Adjust stock"}
              </Text>
              <Pressable
                disabled={busy}
                accessibilityLabel="Close"
                onPress={() => setForm(null)}
                style={s.headerIcon}
              >
                <Ionicons name="close" size={24} color={C.green} />
              </Pressable>
            </View>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={[s.content, { gap: 22 }]}
            >
              {form === "ingredient" ? (
                <>
                  <Field
                    label="Name"
                    value={name}
                    onChange={setName}
                    placeholder="Flour"
                  />
                  <Field
                    label="Unit"
                    value={unit}
                    onChange={setUnit}
                    placeholder="kg"
                  />
                  <Field
                    label="Minimum"
                    value={minimum}
                    onChange={setMinimum}
                    numeric
                  />
                </>
              ) : form === "settings" ? (
                <Field
                  label={`Minimum (${ingredient?.unit})`}
                  value={minimum}
                  onChange={setMinimum}
                  numeric
                />
              ) : (
                <>
                  <IngredientDropdown
                    key={form || "closed"}
                    items={data.ingredients}
                    value={ingredientId}
                    disabled={busy}
                    onChange={(id) => {
                      setIngredientId(id);
                      setBatchId("");
                      setReview(null);
                    }}
                  />
                  {form === "use" && (
                    <View style={s.actions}>
                      {["Auto", "Manual"].map((v, index) => (
                        <Pressable
                          key={v}
                          onPress={() => {
                            setManual(!!index);
                            setReview(null);
                          }}
                          style={[
                            s.chip,
                            { flex: 1, alignItems: "center" },
                            manual === !!index && s.selectedChip,
                          ]}
                        >
                          <Text
                            style={
                              manual === !!index
                                ? s.selectedChipText
                                : s.chipText
                            }
                          >
                            {v}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {(form === "adjust" || (form === "use" && manual)) && (
                    <>
                      <Text style={s.label}>Batch</Text>
                      <View style={s.chips}>
                        <PagedList
                          resetKey={`${ingredientId}:${form}:${manual}`}
                          items={data.batches.filter(
                            (b) =>
                              b.ingredientId === ingredientId &&
                              (form === "adjust" ||
                                (b.quantity > 0 && b.expiry >= today())),
                          )}
                          renderItem={(b) => (
                            <Pressable
                              key={b.id}
                              onPress={() => {
                                setBatchId(b.id);
                                setReview(null);
                              }}
                              style={[
                                s.chip,
                                b.id === batchId && s.selectedChip,
                              ]}
                            >
                              <Text
                                style={
                                  b.id === batchId
                                    ? s.selectedChipText
                                    : s.chipText
                                }
                              >
                                {b.code} · {fmt(b.quantity)} {ingredient?.unit}
                              </Text>
                            </Pressable>
                          )}
                        />
                      </View>
                    </>
                  )}
                  {form === "receive" && (
                    <Field
                      label="Batch"
                      value={code}
                      onChange={setCode}
                      placeholder="FL-001"
                    />
                  )}
                  <Field
                    label={`${form === "adjust" ? "Counted quantity" : "Quantity"}${ingredient ? ` (${ingredient.unit})` : ""}`}
                    value={quantity}
                    onChange={(v) => {
                      setQuantity(v);
                      setReview(null);
                    }}
                    numeric
                  />
                  {form === "receive" && (
                    <>
                      <DateField
                        label="Received"
                        value={received}
                        onChange={(value) => {
                          setReceived(value);
                          if (expiry && expiry < value) setExpiry("");
                        }}
                        maximum={today()}
                      />
                      <DateField
                        label="Expiry"
                        value={expiry}
                        onChange={setExpiry}
                        minimum={received}
                      />
                    </>
                  )}
                  {form === "adjust" && (
                    <>
                      <Field
                        label="Reason"
                        value={reason}
                        onChange={setReason}
                        placeholder="Damaged stock"
                      />
                      {batchId && quantity !== "" && (
                        <Text style={s.quantity}>
                          Change ·{" "}
                          {fmt(
                            round(
                              Number(quantity) -
                                (data.batches.find((b) => b.id === batchId)
                                  ?.quantity || 0),
                            ),
                          )}{" "}
                          {ingredient?.unit}
                        </Text>
                      )}
                    </>
                  )}
                  {review && (
                    <View style={s.card}>
                      {review.map((a) => (
                        <View
                          key={a.batchId}
                          style={[s.between, { paddingVertical: 10 }]}
                        >
                          <Text style={s.rowTitle}>
                            {data.batches.find((b) => b.id === a.batchId)?.code}
                          </Text>
                          <Text style={s.quantity}>
                            {fmt(a.quantity)} {ingredient?.unit}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </>
              )}
              {error && (
                <Text accessibilityRole="alert" style={{ color: "#AF3E32" }}>
                  {error}
                </Text>
              )}
            </ScrollView>
            <View style={s.formFooter}>
              <Button
                title={
                  busy
                    ? "Saving…"
                    : form === "use" && !review
                      ? "Continue"
                      : "Save"
                }
                disabled={busy}
                onPress={save}
              />
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 24,
    paddingTop: 18,
    paddingBottom: 22,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  eyebrow: {
    fontSize: 10,
    fontFamily: "Manrope_700Bold",
    letterSpacing: 3,
    color: C.green,
    marginBottom: 9,
  },
  title: {
    fontSize: 34,
    fontFamily: "Manrope_700Bold",
    letterSpacing: -1.2,
    color: C.ink,
  },
  headerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: C.line,
    alignItems: "center",
    justifyContent: "center",
  },
  content: { paddingHorizontal: 24, paddingBottom: 32, gap: 16 },
  hero: { backgroundColor: C.green, padding: 25, borderRadius: 24, gap: 14 },
  heroLabel: { color: "#D5E8CF", fontSize: 12, letterSpacing: 0.6 },
  heroNumber: {
    fontSize: 64,
    color: "#FFFDF3",
    fontFamily: "Manrope_600SemiBold",
    letterSpacing: -2,
  },
  heroFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#3B6856",
    paddingTop: 18,
  },
  localBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#C6DD83" },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  actions: { flexDirection: "row", gap: 12 },
  action: {
    flex: 1,
    flexBasis: 0,
    minWidth: 0,
    width: 0,
    minHeight: 108,
    padding: 20,
    borderRadius: 20,
    backgroundColor: "#ECEDE4",
    justifyContent: "space-between",
    gap: 15,
  },
  actionText: { fontSize: 15, fontFamily: "Manrope_700Bold", color: C.green },
  section: {
    fontSize: 20,
    fontFamily: "Manrope_600SemiBold",
    color: C.ink,
    letterSpacing: -0.4,
    marginTop: 10,
  },
  link: { fontSize: 13, fontFamily: "Manrope_700Bold", color: C.green },
  movement: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderColor: C.line,
  },
  moveIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    justifyContent: "center",
    alignItems: "center",
  },
  rowTitle: { fontSize: 16, fontFamily: "Manrope_600SemiBold", color: C.ink },
  small: { fontSize: 12, color: C.muted, lineHeight: 18 },
  quantity: { fontSize: 17, fontFamily: "Manrope_600SemiBold", color: C.ink },
  card: {
    padding: 20,
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: C.line,
    borderRadius: 20,
  },
  warning: {
    backgroundColor: "#F4EAD7",
    borderRadius: 16,
    paddingLeft: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  empty: { alignItems: "center", paddingVertical: 36, gap: 18 },
  emptyTitle: {
    fontSize: 22,
    fontFamily: "Manrope_600SemiBold",
    color: C.green,
    marginTop: 20,
  },
  button: {
    backgroundColor: C.green,
    minHeight: 54,
    borderRadius: 16,
    paddingHorizontal: 22,
    justifyContent: "center",
    alignItems: "center",
  },
  secondary: { backgroundColor: "#E4EBD9" },
  buttonText: { color: "#FFFDF3", fontSize: 15, fontWeight: "700" },
  nav: {
    flexDirection: "row",
    paddingTop: 10,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderColor: C.line,
    backgroundColor: "#FFFDF8",
  },
  navItem: { flex: 1, alignItems: "center", gap: 5, minHeight: 60 },
  navPill: {
    minWidth: 68,
    minHeight: 58,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    overflow: "hidden",
  },
  search: {
    minHeight: 54,
    backgroundColor: "#ECEEE6",
    borderRadius: 16,
    paddingHorizontal: 18,
    fontSize: 16,
    color: C.ink,
  },
  stockRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderColor: C.line,
  },
  ingredientIcon: {
    height: 48,
    width: 48,
    backgroundColor: "#E6EBDD",
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  label: { fontSize: 13, fontFamily: "Manrope_600SemiBold", color: C.ink },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: "#D9DED2",
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: "#FFFDF8",
    color: C.ink,
    fontSize: 18,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 18,
    paddingVertical: 15,
    borderRadius: 14,
    backgroundColor: "#E9ECE3",
    minHeight: 48,
  },
  selectedChip: { backgroundColor: C.green },
  chipText: { color: C.green, fontSize: 14 },
  selectedChipText: { color: "#fff", fontSize: 14, fontWeight: "600" },
  formFooter: { padding: 24, borderTopWidth: 1, borderColor: C.line },
});
