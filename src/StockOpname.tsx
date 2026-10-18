import React, { useRef, useState } from "react";
import {
  Alert,
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
import Storage from "expo-sqlite/kv-store";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import type { Inventory } from "./inventory";
import { round } from "./inventory";
import { startCount, type CountDraft } from "./opname";
import { readCountFile } from "./excel";
import { exportCount } from "./reports";
import PagedList from "./PagedList";

function ActionButton({
  title,
  onPress,
  busy,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  busy: boolean;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={onPress}
      style={[s.button, secondary && s.secondary, busy && { opacity: 0.5 }]}
    >
      <Text
        style={{ color: secondary ? "#184D3E" : "white", fontWeight: "600" }}
      >
        {title}
      </Text>
    </Pressable>
  );
}

export default function StockOpname({
  data,
  owner,
  visible,
  onClose,
  onApprove,
}: {
  data: Inventory;
  owner: string;
  visible: boolean;
  onClose: () => void;
  onApprove: (draft: CountDraft) => Promise<string>;
}) {
  const key = `stockroom-opname-v1:${owner}`;
  const [error, setError] = useState("");
  const [loaded] = useState<{ draft: CountDraft | null; error: string }>(() => {
    try {
      const raw = Storage.getItemSync(key);
      if (!raw) return { draft: null, error: "" };
      const saved = JSON.parse(raw) as CountDraft;
      if (
        !saved.id ||
        !Array.isArray(saved.rows) ||
        typeof saved.reason !== "string" ||
        saved.rows.some(
          (r) => typeof r.count !== "string" || typeof r.expected !== "number",
        )
      )
        throw Error();
      return { draft: saved, error: "" };
    } catch {
      return {
        draft: null,
        error:
          "Could not read the saved count. The draft was kept on this device; do not clear app data.",
      };
    }
  });
  const loadError = loaded.error;
  const [draft, setDraft] = useState(loaded.draft);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [search, setSearch] = useState("");
  const [differences, setDifferences] = useState(false);
  const [confirming, setConfirming] = useState(false);
  function persist(next: CountDraft) {
    Storage.setItemSync(key, JSON.stringify(next));
    setDraft(next);
    setConfirming(false);
  }
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not complete this action.",
      );
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  function update(next: CountDraft) {
    if (loadError) {
      setError(loadError);
      return;
    }
    try {
      persist(next);
      setError("");
    } catch {
      setError(
        "Could not save draft on this device. Free storage and try again.",
      );
    }
  }
  async function importFile() {
    if (!draft) return;
    const result = await DocumentPicker.getDocumentAsync({
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      copyToCacheDirectory: true,
      base64: false,
    });
    if (result.canceled) return;
    const asset = result.assets[0];
    if ((asset.size || 0) > 10 * 1024 * 1024)
      throw Error("Choose an Excel file smaller than 10 MB.");
    const file = Platform.OS === "web" ? null : new File(asset.uri);
    try {
      const bytes = asset.file
        ? new Uint8Array(await asset.file.arrayBuffer())
        : await file!.bytes();
      persist(await readCountFile(bytes, draft));
    } finally {
      if (file) {
        try {
          file.delete();
        } catch {
          /* Cache cleanup is best effort. */
        }
      }
    }
  }
  const counted = draft?.rows.filter((r) => r.count.trim() !== "") || [];
  const changed = counted.filter((r) => Number(r.count) !== r.expected);
  const current = new Map(data.batches.map((b) => [b.id, b]));
  const conflicts = counted.filter(
    (r) => current.get(r.batchId)?.quantity !== r.expected,
  );
  const button = (title: string, action: () => void, secondary = false) => (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={action}
      style={[s.button, secondary && s.secondary, busy && { opacity: 0.5 }]}
    >
      <Text
        style={{ color: secondary ? "#184D3E" : "white", fontWeight: "600" }}
      >
        {title}
      </Text>
    </Pressable>
  );
  return (
    <Modal
      visible={visible}
      animationType="slide"
      onRequestClose={() => {
        if (!working.current) onClose();
      }}
    >
      <SafeAreaView style={s.screen}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <View style={s.header}>
            <Text style={s.title}>Stock opname</Text>
            {button("Close", onClose, true)}
          </View>
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={s.content}
          >
            {!!loadError && <Text style={s.error}>{loadError}</Text>}
            {!draft ? (
              <>
                {!loadError &&
                  button("Start count", () => update(startCount(data)))}
              </>
            ) : (
              <>
                <Text style={s.text}>
                  {draft.approvedAt
                    ? "Approved locally · Check sync under More"
                    : "Draft saved"}
                </Text>
                <Text style={s.text}>
                  {counted.length} / {draft.rows.length} counted ·{" "}
                  {changed.length} differences
                </Text>
                <Text style={s.label}>Adjustment reason</Text>
                <TextInput
                  style={s.input}
                  placeholder="Stock opname"
                  placeholderTextColor="#000000"
                  accessibilityLabel="Adjustment reason"
                  editable={!busy && !draft.approvedAt}
                  value={draft.reason}
                  onChangeText={(reason) => update({ ...draft, reason })}
                />
                {!draft.approvedAt && (
                  <>
                    <ActionButton
                      busy={busy}
                      secondary
                      title="Download count template"
                      onPress={() =>
                        void run(async () => {
                          if (await exportCount(draft, "xlsx", true))
                            Alert.alert("Saved", "Count template saved.");
                        })
                      }
                    />
                    <ActionButton
                      busy={busy}
                      title="Import physical counts"
                      onPress={() => void run(importFile)}
                    />
                  </>
                )}
                <TextInput
                  style={s.input}
                  placeholder="Search name or batch"
                  placeholderTextColor="#000000"
                  accessibilityLabel="Search counts"
                  value={search}
                  onChangeText={setSearch}
                />
                {button(
                  differences ? "Show all batches" : "Show differences",
                  () => setDifferences(!differences),
                  true,
                )}
                {!!conflicts.length && !draft.approvedAt && (
                  <Text style={s.error}>
                    {conflicts.length} batches changed. Review before approval.
                  </Text>
                )}
                <PagedList
                  resetKey={`${search}:${differences}`}
                  items={draft.rows.filter(
                    (r) =>
                      `${r.name} ${r.batch}`
                        .toLowerCase()
                        .includes(search.toLowerCase()) &&
                      (!differences ||
                        (r.count.trim() !== "" &&
                          Number(r.count) !== r.expected)),
                  )}
                  renderItem={(r) => {
                    const actual = current.get(r.batchId);
                    const conflict =
                      !draft.approvedAt && actual?.quantity !== r.expected;
                    return (
                      <View key={r.batchId} style={s.card}>
                        <Text style={s.label}>
                          {r.name} · {r.batch}
                        </Text>
                        <Text style={s.text}>
                          System: {r.expected} {r.unit} · Difference:{" "}
                          {r.count.trim() === ""
                            ? "Not counted"
                            : Number.isFinite(Number(r.count))
                              ? round(Number(r.count) - r.expected)
                              : "Invalid count"}
                        </Text>
                        <TextInput
                          style={s.input}
                          accessibilityLabel={`Physical count for ${r.name} batch ${r.batch}`}
                          placeholder="Not counted"
                          placeholderTextColor="#000000"
                          keyboardType="decimal-pad"
                          editable={!busy && !draft.approvedAt}
                          value={r.count}
                          onChangeText={(count) =>
                            update({
                              ...draft,
                              rows: draft.rows.map((row) =>
                                row.batchId === r.batchId
                                  ? { ...row, count }
                                  : row,
                              ),
                            })
                          }
                        />
                        {conflict && (
                          <>
                            <Text style={s.error}>
                              Current system:{" "}
                              {actual
                                ? `${actual.quantity} ${r.unit}`
                                : "Batch removed"}
                              . Recheck your physical count.
                            </Text>
                            {actual &&
                              button(
                                "Use current system quantity",
                                () =>
                                  update({
                                    ...draft,
                                    rows: draft.rows.map((row) =>
                                      row.batchId === r.batchId
                                        ? { ...row, expected: actual.quantity }
                                        : row,
                                    ),
                                  }),
                                true,
                              )}
                          </>
                        )}
                      </View>
                    );
                  }}
                />
                {!draft.rows.length && (
                  <Text style={s.text}>
                    No batches yet. Add stock, then start a new count.
                  </Text>
                )}
                {!draft.approvedAt &&
                  (confirming ? (
                    <View style={s.card}>
                      <Text style={s.label}>
                        Approve {counted.length} counted batches?
                      </Text>
                      <Text style={s.text}>
                        {changed.length} stock quantities will change.
                      </Text>
                      <ActionButton
                        busy={busy}
                        title="Confirm all adjustments"
                        onPress={() =>
                          void run(async () => {
                            const approvedAt = await onApprove(draft);
                            persist({ ...draft, approvedAt });
                          })
                        }
                      />
                      {button(
                        "Keep reviewing",
                        () => setConfirming(false),
                        true,
                      )}
                    </View>
                  ) : (
                    button("Review bulk approval", () => setConfirming(true))
                  ))}
                {button(
                  draft.approvedAt
                    ? "Start new count"
                    : "Replace draft with new count",
                  () =>
                    Alert.alert(
                      "Start new count?",
                      "Replace the saved count?",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Start new count",
                          onPress: () => update(startCount(data)),
                        },
                      ],
                    ),
                  true,
                )}
              </>
            )}
            {!!error && (
              <Text accessibilityRole="alert" style={s.error}>
                {error}
              </Text>
            )}
            {busy && <Text style={s.text}>Working…</Text>}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F5F0" },
  header: {
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  title: { flex: 1, fontSize: 25, color: "#202E28", fontWeight: "700" },
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  text: { color: "#202E28", fontSize: 14, lineHeight: 21 },
  label: { color: "#202E28", fontWeight: "600", fontSize: 16 },
  input: {
    color: "#000000",
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "#D9DED2",
    borderRadius: 12,
    padding: 14,
    minHeight: 52,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#184D3E",
    padding: 15,
    minHeight: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  secondary: { backgroundColor: "#E4EBD9" },
  card: { backgroundColor: "#FFFFFF", borderRadius: 14, padding: 16, gap: 12 },
  error: { color: "#AF3E32", lineHeight: 21 },
});
