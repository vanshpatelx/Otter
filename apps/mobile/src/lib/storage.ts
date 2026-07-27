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

export async function clearTarget(): Promise<void> {
  if (Platform.OS === "web") {
    if (typeof localStorage !== "undefined") localStorage.removeItem(KEY);
  } else {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.deleteItemAsync(KEY);
  }
}
