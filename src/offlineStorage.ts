import Storage from "expo-sqlite/kv-store";
import { createOfflineStore } from "./offline";

export const offlineStorage = createOfflineStore(Storage);
