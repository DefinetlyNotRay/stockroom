import React, { useEffect } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import AppScreen from "./src/AppScreen";
import { ActivityIndicator, AppState, View } from "react-native";
import { cloud } from "./src/cloud";
import {
  useFonts,
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";

export default function App() {
  useEffect(() => {
    const client = cloud;
    if (!client) return;
    const refresh = (state: string | null | undefined) => {
      if (state === "active") client.auth.startAutoRefresh();
      else client.auth.stopAutoRefresh();
    };
    refresh(AppState.currentState);
    const subscription = AppState.addEventListener("change", refresh);
    return () => {
      subscription.remove();
      client.auth.stopAutoRefresh();
    };
  }, []);
  const [loaded, error] = useFonts({
    Manrope_400Regular,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });
  if (!loaded && !error)
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#F6F5F0",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator color="#184D3E" />
      </View>
    );
  return (
    <SafeAreaProvider>
      <AppScreen />
    </SafeAreaProvider>
  );
}
