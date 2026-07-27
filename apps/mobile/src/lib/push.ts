import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

/**
 * Get this phone's Expo push token, or null when push isn't available.
 *
 * The Worker buzzes the phone for approvals via Expo, so the app's side is just
 * "ask permission, hand back a token". It returns null (rather than throwing)
 * on the web, on a simulator, or when the user declines — the app still works,
 * it just won't get background pushes.
 */
export async function getExpoPushToken(): Promise<string | null> {
  // Push tokens only exist on real iOS/Android hardware.
  if (Platform.OS === "web" || !Device.isDevice) return null;

  try {
    // Android needs a channel before notifications display.
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("approvals", {
        name: "Approvals",
        importance: Notifications.AndroidImportance.HIGH,
        sound: "default",
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      status = (await Notifications.requestPermissionsAsync()).status;
    }
    if (status !== "granted") return null;

    // The EAS project id ties the token to this app in Expo's push service.
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
    const token = await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined);
    return token.data ?? null;
  } catch {
    // Missing native module (Expo Go), denied prompt, no network — all non-fatal.
    return null;
  }
}

/**
 * Foreground display behaviour: show approval alerts even while the app is
 * open, so you don't miss one you're looking right at.
 */
export function configureForegroundNotifications(): void {
  // Web has no notification handler; skip rather than throw at startup.
  if (Platform.OS === "web") return;
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Missing native module (e.g. Expo Go without the config plugin) — non-fatal.
  }
}
