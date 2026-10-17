import React, { ReactNode, useState } from "react";
import { Pressable, Text, View } from "react-native";

export const LIST_PAGE_SIZE = 25;
export function PageControls({
  page,
  hasNext,
  busy = false,
  onChange,
}: {
  page: number;
  hasNext: boolean;
  busy?: boolean;
  onChange: (page: number) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <Pressable
        accessibilityRole="button"
        disabled={busy || page === 0}
        onPress={() => onChange(page - 1)}
        style={{ padding: 14, opacity: busy || page === 0 ? 0.4 : 1 }}
      >
        <Text style={{ color: "#184D3E" }}>Previous</Text>
      </Pressable>
      <Text style={{ color: "#778078" }}>Page {page + 1}</Text>
      <Pressable
        accessibilityRole="button"
        disabled={busy || !hasNext}
        onPress={() => onChange(page + 1)}
        style={{ padding: 14, opacity: busy || !hasNext ? 0.4 : 1 }}
      >
        <Text style={{ color: "#184D3E" }}>Next</Text>
      </Pressable>
    </View>
  );
}

export default function PagedList<T>({
  items,
  renderItem,
  resetKey = "",
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  resetKey?: string;
}) {
  const [position, setPosition] = useState({ key: resetKey, page: 0 });
  const page =
    position.key === resetKey
      ? Math.min(
          position.page,
          Math.max(0, Math.ceil(items.length / LIST_PAGE_SIZE) - 1),
        )
      : 0;
  return (
    <>
      {items
        .slice(page * LIST_PAGE_SIZE, (page + 1) * LIST_PAGE_SIZE)
        .map(renderItem)}
      {items.length > LIST_PAGE_SIZE && (
        <PageControls
          page={page}
          hasNext={(page + 1) * LIST_PAGE_SIZE < items.length}
          onChange={(next) => setPosition({ key: resetKey, page: next })}
        />
      )}
    </>
  );
}
