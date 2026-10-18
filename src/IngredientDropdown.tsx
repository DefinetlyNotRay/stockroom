import React, { useState } from "react";
import {
  Pressable,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { Ingredient } from "./inventory";

export default function IngredientDropdown({
  items,
  value,
  onChange,
  disabled = false,
}: {
  items: Ingredient[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = items.find((item) => item.id === value);
  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <View style={styles.field}>
      <Text style={styles.label}>Ingredient</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Ingredient: ${selected?.name || "Select ingredient"}`}
        accessibilityState={{ expanded: open, disabled }}
        disabled={disabled}
        onPress={() => {
          setOpen(!open);
          setSearch("");
        }}
        style={[styles.trigger, disabled && { opacity: 0.5 }]}
      >
        <Text numberOfLines={2} style={styles.value}>
          {selected?.name || "Select ingredient"}
        </Text>
        <Ionicons
          name={open ? "chevron-up" : "chevron-down"}
          size={20}
          color="#184D3E"
        />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <KeyboardAvoidingView
          style={styles.overlay}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close ingredient dropdown"
            style={StyleSheet.absoluteFill}
            onPress={() => setOpen(false)}
          />
          <View style={styles.menu}>
            <View style={styles.searchRow}>
              <Ionicons name="search-outline" size={19} color="#778078" />
              <TextInput
                accessibilityLabel="Search ingredients"
                placeholder="Search ingredients"
                placeholderTextColor="#000000"
                value={search}
                onChangeText={setSearch}
                editable={!disabled}
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.search}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close ingredient dropdown"
                onPress={() => setOpen(false)}
                style={styles.close}
              >
                <Ionicons name="close" size={22} color="#184D3E" />
              </Pressable>
            </View>
            <FlatList
              key={search}
              style={styles.options}
              data={filtered}
              keyExtractor={(item) => item.id}
              extraData={{ value, disabled }}
              initialNumToRender={8}
              maxToRenderPerBatch={8}
              windowSize={5}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  key={item.id}
                  accessibilityRole="button"
                  accessibilityState={{ selected: item.id === value }}
                  disabled={disabled}
                  onPress={() => {
                    onChange(item.id);
                    setOpen(false);
                    setSearch("");
                  }}
                  style={[styles.option, item.id === value && styles.selected]}
                >
                  <Text style={styles.value}>{item.name}</Text>
                  {item.id === value && (
                    <Ionicons name="checkmark" size={20} color="#184D3E" />
                  )}
                </Pressable>
              )}
              ListEmptyComponent={
                <Text style={styles.empty}>No ingredients found.</Text>
              }
            />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 8 },
  label: { fontSize: 13, color: "#202E28", fontWeight: "600" },
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 56,
    padding: 16,
    borderWidth: 1,
    borderColor: "#D9DED2",
    borderRadius: 14,
    backgroundColor: "#FFFDF3",
  },
  value: { flex: 1, fontSize: 16, color: "#202E28" },
  menu: {
    width: "100%",
    maxHeight: "80%",
    borderWidth: 1,
    borderColor: "#D9DED2",
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "#FFFDF3",
  },
  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderColor: "#E4E7DE",
  },
  search: { flex: 1, minHeight: 52, fontSize: 16, color: "#202E28" },
  overlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
    backgroundColor: "rgba(20, 35, 28, 0.35)",
  },
  close: {
    minWidth: 44,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  options: { height: 280, flexGrow: 0, flexShrink: 1 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    minHeight: 52,
    padding: 14,
    borderBottomWidth: 1,
    borderColor: "#E4E7DE",
  },
  selected: { backgroundColor: "#E4EBD9" },
  empty: { padding: 16, color: "#778078" },
});
