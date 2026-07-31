import { Platform } from "react-native";
import type { WorkerTarget } from "./useWorker";

/**
 * Where the paired machine is remembered.
 *
 * The pairing code is a credential, so on a device it lives in the platform
 * keychain via SecureStore. On web (how the app is developed and demoed) there
 * is no keychain, so it falls back to localStorage — same shape, both async.
 */
const KEY = "otter.target";

export async function loadTarget(): Promise<WorkerTarget | null> {
  try {
    let raw: string | null;
    if (Platform.OS === "web") {
      raw = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null;
    } else {
      const SecureStore = await import("expo-secure-store");
      raw = await SecureStore.getItemAsync(KEY);
    }
    return raw ? (JSON.parse(raw) as WorkerTarget) : null;
  } catch {
    return null;
  }
}

export async function saveTarget(target: WorkerTarget): Promise<void> {
  const raw = JSON.stringify(target);
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.setItem(KEY, raw);
  } else {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync(KEY, raw);
  }
}

/**
 * A stable per-install id so this phone maps to one revocable device session on
 * the Worker (two phones are two devices; a restart keeps the same one). Not a
 * secret — kept in plain storage, generated once.
 */
const CLIENT_ID_KEY = "otter.clientId";

export async function getClientId(): Promise<string> {
  const gen = () => `m_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
  try {
    if (Platform.OS === "web") {
      if (typeof localStorage === "undefined") return gen();
      let id = localStorage.getItem(CLIENT_ID_KEY);
      if (!id) localStorage.setItem(CLIENT_ID_KEY, (id = gen()));
      return id;
    }
    const SecureStore = await import("expo-secure-store");
    let id = await SecureStore.getItemAsync(CLIENT_ID_KEY);
    if (!id) await SecureStore.setItemAsync(CLIENT_ID_KEY, (id = gen()));
    return id;
  } catch {
    return gen();
  }
}

export async function clearTarget(): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } else {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(KEY);
  }
}
