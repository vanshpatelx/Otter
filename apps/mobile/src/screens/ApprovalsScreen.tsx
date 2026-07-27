import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { colors, radius, space } from "../theme";
import type { ApprovalRequest } from "@ai-workspace/protocol";

/**
 * The reason this app exists on a phone: clearing agent gates while you're away
 * from the desk. Each pending approval is a big card with the command it wants
 * to run and two unmissable buttons.
 */
export function ApprovalsScreen({
  approvals,
  onResolve,
}: {
  approvals: ApprovalRequest[];
  onResolve: (id: string, approved: boolean) => void;
}) {
  if (approvals.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyIcon}>🛡️</Text>
        <Text style={styles.emptyText}>Nothing waiting</Text>
        <Text style={styles.emptySub}>Agent actions that need your call will show up here.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={{ padding: space(3), gap: space(3) }}>
      {approvals.map((a) => (
        <View key={a.id} style={styles.card}>
          <Text style={styles.kind}>{a.kind.replace(/-/g, " ")}</Text>
          <Text style={styles.summary}>{a.summary}</Text>
          <View style={styles.cmdBox}>
            <Text style={styles.cmd}>{a.details}</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={[styles.btn, styles.reject]} onPress={() => onResolve(a.id, false)}>
              <Text style={styles.rejectText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btn, styles.approve]} onPress={() => onResolve(a.id, true)}>
              <Text style={styles.approveText}>Approve</Text>
            </TouchableOpacity>
          </View>
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
  card: {
    backgroundColor: colors.card,
    borderColor: colors.amber,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(4),
  },
  kind: { color: colors.amber, fontSize: 11, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  summary: { color: colors.text, fontSize: 15, fontWeight: "600", marginTop: space(1.5) },
  cmdBox: { backgroundColor: colors.bg, borderRadius: radius.sm, padding: space(2.5), marginTop: space(2.5) },
  cmd: { color: colors.textMuted, fontSize: 12, fontFamily: "monospace" },
  actions: { flexDirection: "row", gap: space(2.5), marginTop: space(3.5) },
  btn: { flex: 1, borderRadius: radius.md, paddingVertical: space(3), alignItems: "center" },
  reject: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.red },
  rejectText: { color: colors.red, fontWeight: "700", fontSize: 15 },
  approve: { backgroundColor: colors.emerald },
  approveText: { color: "#062012", fontWeight: "700", fontSize: 15 },
});
