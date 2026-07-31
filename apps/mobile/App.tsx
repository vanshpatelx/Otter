import { useEffect, useState } from "react";
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView, Platform, StatusBar } from "react-native";
import { StatusBar as ExpoStatusBar } from "expo-status-bar";
import { Logo } from "./src/components/Logo";
import { colors, radius, space } from "./src/theme";
import { useWorker, type WorkerTarget } from "./src/lib/useWorker";
import { configureForegroundNotifications } from "./src/lib/push";
import { loadTarget, saveTarget, clearTarget, getClientId } from "./src/lib/storage";

// Show approval notifications even while the app is in the foreground.
configureForegroundNotifications();
import { PairScreen } from "./src/screens/PairScreen";
import { ChatScreen } from "./src/screens/ChatScreen";
import { ApprovalsScreen } from "./src/screens/ApprovalsScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";

type Tab = "chat" | "approvals" | "activity";

const STATUS_LABEL = {
  connecting: "connecting…",
  connected: "online",
  disconnected: "reconnecting…",
  unauthorized: "bad code",
} as const;

const STATUS_COLOR = {
  connecting: colors.amber,
  connected: colors.emerald,
  disconnected: colors.amber,
  unauthorized: colors.red,
} as const;

/**
 * Otter, on a phone.
 *
 * A thin companion to the workstation: no target paired shows the pairing
 * screen; once paired it opens one connection and gives three tabs — chat,
 * approvals, and the activity feed — with the approvals tab badged, because
 * clearing a gate on the go is the whole point.
 */
export function App() {
  const [target, setTarget] = useState<WorkerTarget | null>(null);
  const [clientId, setClientId] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [tab, setTab] = useState<Tab>("chat");

  useEffect(() => {
    Promise.all([loadTarget(), getClientId()]).then(([t, id]) => {
      setTarget(t);
      setClientId(id);
      setLoaded(true);
    });
  }, []);

  // The Worker issued this phone a session token — store it in place of the
  // pairing code so the phone can be revoked on its own.
  const onSession = (sessionToken: string) => {
    setTarget((cur) => {
      if (!cur) return cur;
      const next = { ...cur, token: sessionToken };
      void saveTarget(next);
      return next;
    });
  };

  if (!loaded) {
    return <View style={{ flex: 1, backgroundColor: colors.bg }} />;
  }

  if (!target) {
    return (
      <>
        <ExpoStatusBar style="light" />
        <PairScreen
          onPair={(t) => {
            void saveTarget(t);
            setTarget(t);
          }}
        />
      </>
    );
  }

  return (
    <Paired
      target={target}
      clientId={clientId}
      onSession={onSession}
      tab={tab}
      onTab={setTab}
      onUnpair={() => {
        void clearTarget();
        setTarget(null);
      }}
    />
  );
}

function Paired({
  target,
  clientId,
  onSession,
  tab,
  onTab,
  onUnpair,
}: {
  target: WorkerTarget;
  clientId?: string;
  onSession: (sessionToken: string) => void;
  tab: Tab;
  onTab: (t: Tab) => void;
  onUnpair: () => void;
}) {
  const conn = useWorker(target, { clientId, onSession });

  return (
    <SafeAreaView style={styles.root}>
      <ExpoStatusBar style="light" />

      <View style={styles.header}>
        <View style={styles.logoChip}>
          <Logo size={18} color={colors.navy} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.appName}>Otter</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[conn.status] }]} />
            <Text style={styles.statusText} numberOfLines={1}>
              {conn.machine?.hostname ?? "…"} · {STATUS_LABEL[conn.status]}
            </Text>
          </View>
        </View>
        <TouchableOpacity onPress={onUnpair} style={styles.unpair}>
          <Text style={styles.unpairText}>Unpair</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>
        {tab === "chat" && <ChatScreen conn={conn} />}
        {tab === "approvals" && <ApprovalsScreen approvals={conn.approvals} onResolve={conn.resolveApproval} />}
        {tab === "activity" && <ActivityScreen notices={conn.notices} />}
      </View>

      <View style={styles.tabbar}>
        <TabButton label="Chat" icon="💬" active={tab === "chat"} onPress={() => onTab("chat")} />
        <TabButton
          label="Approvals"
          icon="🛡️"
          active={tab === "approvals"}
          badge={conn.approvals.length}
          onPress={() => onTab("approvals")}
        />
        <TabButton label="Activity" icon="📡" active={tab === "activity"} onPress={() => onTab("activity")} />
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  label,
  icon,
  active,
  badge,
  onPress,
}: {
  label: string;
  icon: string;
  active: boolean;
  badge?: number;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.tab} onPress={onPress}>
      <View>
        <Text style={[styles.tabIcon, { opacity: active ? 1 : 0.5 }]}>{icon}</Text>
        {badge ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 9 ? "9+" : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.tabLabel, { color: active ? colors.text : colors.textFaint }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, paddingTop: Platform.OS === "android" ? StatusBar.currentHeight : 0 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2.5),
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  logoChip: { width: 30, height: 30, borderRadius: radius.sm, backgroundColor: "#fff", alignItems: "center", justifyContent: "center" },
  appName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: space(1.5), marginTop: space(0.5) },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusText: { color: colors.textMuted, fontSize: 12 },
  unpair: { paddingHorizontal: space(2.5), paddingVertical: space(1.5), borderRadius: radius.sm, borderWidth: 1, borderColor: colors.cardBorder },
  unpairText: { color: colors.textMuted, fontSize: 12 },
  body: { flex: 1 },
  tabbar: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.cardBorder, backgroundColor: colors.card },
  tab: { flex: 1, alignItems: "center", paddingVertical: space(2.5), gap: space(1) },
  tabIcon: { fontSize: 20, textAlign: "center" },
  tabLabel: { fontSize: 11 },
  badge: {
    position: "absolute",
    top: -4,
    right: -10,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  badgeText: { color: "#fff", fontSize: 9, fontWeight: "700" },
});
