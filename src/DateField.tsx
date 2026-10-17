import React from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import { DateTimePickerAndroid } from "@react-native-community/datetimepicker";
import { Ionicons } from "@expo/vector-icons";

function fromDate(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
function toDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}
export default function DateField({
  label,
  value,
  onChange,
  minimum,
  maximum,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minimum?: string;
  maximum?: string;
}) {
  const open = () => {
    Keyboard.dismiss();
    const fallback = minimum || maximum || fromDate(new Date());
    const bounded =
      value && (!minimum || value >= minimum) && (!maximum || value <= maximum)
        ? value
        : fallback;
    DateTimePickerAndroid.open({
      value: toDate(bounded),
      mode: "date",
      display: "default",
      minimumDate: minimum ? toDate(minimum) : undefined,
      maximumDate: maximum ? toDate(maximum) : undefined,
      onChange: (event, date) => {
        if (event.type === "set" && date) onChange(fromDate(date));
      },
    });
  };
  return (
    <View style={{ gap: 8 }}>
      <Text style={s.label}>{label}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ? toDate(value).toLocaleDateString() : "Select date"}`}
        onPress={open}
        style={s.input}
      >
        <Text style={[s.value, !value && { color: "#91968e" }]}>
          {value
            ? toDate(value).toLocaleDateString(undefined, {
                day: "numeric",
                month: "short",
                year: "numeric",
              })
            : "Select date"}
        </Text>
        <Ionicons name="calendar-outline" size={21} color="#184D3E" />
      </Pressable>
    </View>
  );
}
const s = StyleSheet.create({
  label: { fontSize: 13, fontWeight: "600", color: "#202E28" },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: "#D9DED2",
    borderRadius: 14,
    paddingHorizontal: 16,
    backgroundColor: "#FFFDF8",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  value: { fontSize: 16, color: "#202E28", flexShrink: 1 },
});
