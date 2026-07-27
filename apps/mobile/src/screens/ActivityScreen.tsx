import { View, Text, ScrollView, StyleSheet } from "react-native";
import { colors, radius, space } from "../theme";
import type { WorkerNotification } from "@ai-workspace/protocol";

function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const DOT: Record<string, string> = {
  "task-complete": colors.emerald,
  "command-complete": colors.emerald,
  "command-failed": colors.red,
  "approval-waiting": colors.amber,
  "agent-error": colors.red,
  info: colors.sky,
};

/** What's happened on the machine, newest first — the phone's status feed. */
export function ActivityScreen({ notices }: { notices: WorkerNotification[] }) {
  if (notices.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>📡</Text>
        <Text style={styles.emptyText}>Quiet for now</Text>
        <Text style={styles.emptySub}>Completed turns, failed commands and other events will appear here.</Text>
      </View>
    );
  }
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: space(3), gap: space(2) }}>
      {notices.map((n) => (
        <View key={n.id} style={styles.row}>
          <View style={[styles.dot, { backgroundColor: DOT[n.kind] ?? colors.sky }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{n.title}</Text>
            {n.body ? (
              <Text style={styles.body} numberOfLines={2}>
                {n.body}
              </Text>
            ) : null}
          </View>
          <Text style={styles.time}>{clock(n.at)}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  empty: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: space(6) },
  emptyIcon: { fontSize: 34, marginBottom: space(3) },
  emptyText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  emptySub: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: space(1.5), lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: space(2.5),
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space(3),
  },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: space(1) },
  title: { color: colors.text, fontSize: 14, fontWeight: "500" },
  body: { color: colors.textMuted, fontSize: 12, marginTop: space(0.5) },
  time: { color: colors.textFaint, fontSize: 11 },
});
