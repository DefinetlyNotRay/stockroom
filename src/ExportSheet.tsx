import React, { useRef, useState } from "react";
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import DateField from "./DateField";
import type { Inventory } from "./inventory";
import type { ReportFilters } from "./reportFilters";
import { filterReport } from "./reportFilters";
import { exportReport } from "./reports";
import PagedList from "./PagedList";
export default function ExportSheet({
  data,
  kind,
  onClose,
  loadData,
}: {
  data: Inventory;
  kind: "pdf" | "xlsx";
  onClose: () => void;
  loadData?: (filters: ReportFilters) => Promise<Inventory>;
}) {
  const [range, setRange] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [specific, setSpecific] = useState(false);
  const [ids, setIds] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const working = useRef(false);
  const choice = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      disabled={busy}
      onPress={onPress}
      style={[s.choice, selected && s.active]}
    >
      <Text
        style={{ color: selected ? "#FFFDF3" : "#184D3E", fontWeight: "600" }}
      >
        {label}
      </Text>
    </Pressable>
  );
  async function save() {
    if (working.current) return;
    setError("");
    if (range && (!from || !to)) {
      setError("Choose both dates.");
      return;
    }
    if (specific && !ids.length) {
      setError("Select at least one ingredient.");
      return;
    }
    const filters: ReportFilters = {
      ...(range ? { from, to } : {}),
      ...(specific ? { ingredientIds: ids } : {}),
    };
    working.current = true;
    setBusy(true);
    try {
      filterReport(data, filters);
      const saved = await exportReport(
        loadData ? await loadData(filters) : data,
        kind,
        filters,
      );
      if (saved) {
        Alert.alert("Saved", "Report saved to Downloads.");
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not export.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      animationType="slide"
      onRequestClose={() => {
        if (!working.current) onClose();
      }}
    >
      <SafeAreaView style={s.screen}>
        <View style={s.header}>
          <Text style={s.title}>
            Export {kind === "xlsx" ? "Excel" : "PDF"}
          </Text>
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Close export"
            onPress={onClose}
            style={s.close}
          >
            <Ionicons name="close" size={24} color="#184D3E" />
          </Pressable>
        </View>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={s.content}
        >
          <Text style={s.label}>Movement dates</Text>
          <View style={s.row}>
            {choice("All dates", !range, () => setRange(false))}
            {choice("Date range", range, () => setRange(true))}
          </View>
          {range && (
            <View pointerEvents={busy ? "none" : "auto"} style={s.row}>
              <View style={{ flex: 1 }}>
                <DateField
                  label="From"
                  value={from}
                  onChange={setFrom}
                  maximum={to || undefined}
                />
              </View>
              <View style={{ flex: 1 }}>
                <DateField
                  label="To"
                  value={to}
                  onChange={setTo}
                  minimum={from || undefined}
                />
              </View>
            </View>
          )}
          <Text style={s.label}>Ingredients</Text>
          <View style={s.row}>
            {choice("All ingredients", !specific, () => setSpecific(false))}
            {choice("Select", specific, () => setSpecific(true))}
          </View>
          {specific && (
            <>
              <TextInput
                editable={!busy}
                style={s.search}
                value={search}
                onChangeText={setSearch}
                placeholder="Search ingredients"
                placeholderTextColor="#000000"
                accessibilityLabel="Search ingredients to export"
              />
              <PagedList
                resetKey={search}
                items={data.ingredients.filter((i) =>
                  i.name.toLowerCase().includes(search.toLowerCase()),
                )}
                renderItem={(i) => (
                  <Pressable
                    disabled={busy}
                    key={i.id}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: ids.includes(i.id) }}
                    onPress={() =>
                      setIds((current) =>
                        current.includes(i.id)
                          ? current.filter((id) => id !== i.id)
                          : [...current, i.id],
                      )
                    }
                    style={s.item}
                  >
                    <Text style={{ flex: 1, fontSize: 16, color: "#202E28" }}>
                      {i.name}
                    </Text>
                    <Ionicons
                      name={ids.includes(i.id) ? "checkbox" : "square-outline"}
                      size={24}
                      color="#184D3E"
                    />
                  </Pressable>
                )}
              />
              <Text style={s.small}>{ids.length} selected</Text>
            </>
          )}
          <Text style={s.small}>Current stock + movement history</Text>
          {!!error && (
            <Text accessibilityRole="alert" style={{ color: "#AF3E32" }}>
              {error}
            </Text>
          )}
        </ScrollView>
        <View style={s.footer}>
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={save}
            style={[s.export, busy && { opacity: 0.5 }]}
          >
            <Text style={{ fontSize: 16, color: "#fff", fontWeight: "600" }}>
              {busy ? "Exporting…" : "Export"}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </Modal>
  );
}
const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F6F5F0" },
  header: {
    padding: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 28,
    fontFamily: "Manrope_700Bold",
    color: "#202E28",
    flex: 1,
  },
  close: {
    height: 48,
    width: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    borderWidth: 1,
    borderColor: "#E4E7DE",
  },
  content: { padding: 24, paddingTop: 4, gap: 18 },
  row: { flexDirection: "row", gap: 12 },
  label: {
    fontSize: 15,
    fontFamily: "Manrope_600SemiBold",
    color: "#202E28",
    marginTop: 8,
  },
  choice: {
    flex: 1,
    minHeight: 52,
    borderRadius: 14,
    backgroundColor: "#E4EBD9",
    padding: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  active: { backgroundColor: "#184D3E" },
  search: {
    color: "#000000",
    backgroundColor: "#ECEEE6",
    minHeight: 54,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontSize: 16,
  },
  item: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    minHeight: 56,
    borderBottomWidth: 1,
    borderColor: "#E4E7DE",
  },
  small: { fontSize: 12, color: "#778078" },
  footer: { padding: 24, borderTopWidth: 1, borderColor: "#E4E7DE" },
  export: {
    minHeight: 54,
    backgroundColor: "#184D3E",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
});
