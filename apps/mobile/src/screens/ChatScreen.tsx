import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from "react-native";
import { colors, radius, space } from "../theme";
import type { WorkerConn, ChatMsg } from "../lib/useWorker";

const TOOL_ICON: Record<string, string> = {
  Read: "📖",
  Edit: "✏️",
  Write: "📝",
  Bash: "⚡",
  Grep: "🔍",
  Glob: "🔍",
  WebFetch: "🌐",
  WebSearch: "🌐",
  TodoWrite: "🧠",
  Task: "🤖",
};

/**
 * Chat with an agent on the workstation.
 *
 * A workspace is picked first — a machine hosts several — then its transcript
 * shows with the agent's tool calls folded into compact rows so the reply stays
 * readable on a small screen. Sending creates a session if the workspace has
 * none yet, so the first message just works.
 */
export function ChatScreen({ conn }: { conn: WorkerConn }) {
  const [wsId, setWsId] = useState<string | null>(null);
  const [sessionByWs, setSessionByWs] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  const workspace = conn.workspaces.find((w) => w.workspaceId === wsId) ?? null;
  const sessionId = workspace ? sessionByWs[workspace.workspaceId] ?? workspace.sessionIds[0] ?? null : null;
  const msgs: ChatMsg[] = sessionId ? conn.messages[sessionId] ?? [] : [];

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [msgs.length]);

  const submit = async () => {
    if (!workspace || !draft.trim()) return;
    let sid = sessionId;
    if (!sid) {
      setBusy(true);
      try {
        sid = await conn.createSession(workspace.workspaceId);
        setSessionByWs((m) => ({ ...m, [workspace.workspaceId]: sid! }));
      } catch {
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    conn.send(workspace.workspaceId, sid, draft);
    setDraft("");
  };

  // Workspace picker.
  if (!workspace) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={{ padding: space(3), gap: space(2) }}>
        <Text style={styles.pickHeading}>Workspaces</Text>
        {conn.workspaces.length === 0 && (
          <Text style={styles.emptySub}>No workspaces open on this machine yet. Open one from the desktop app.</Text>
        )}
        {conn.workspaces.map((w) => (
          <TouchableOpacity key={w.workspaceId} style={styles.wsRow} onPress={() => setWsId(w.workspaceId)}>
            <Text style={styles.wsName}>{w.name}</Text>
            {w.branch ? <Text style={styles.wsBranch}>⑂ {w.branch}</Text> : null}
            {w.activeTask ? <View style={styles.workingDot} /> : null}
            <Text style={styles.wsChevron}>›</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
      keyboardVerticalOffset={90}
    >
      <View style={styles.chatHeader}>
        <TouchableOpacity onPress={() => setWsId(null)}>
          <Text style={styles.back}>‹ Workspaces</Text>
        </TouchableOpacity>
        <Text style={styles.chatTitle} numberOfLines={1}>
          {workspace.name}
        </Text>
        {workspace.activeTask ? <ActivityIndicator size="small" color={colors.amber} /> : null}
      </View>

      <ScrollView ref={scrollRef} style={styles.transcript} contentContainerStyle={{ padding: space(3), gap: space(2) }}>
        {msgs.length === 0 && <Text style={styles.emptySub}>Ask the agent anything — it runs in {workspace.name}.</Text>}
        {msgs.map((m, i) => (
          <MessageRow key={i} msg={m} />
        ))}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message the agent…`}
          placeholderTextColor={colors.textFaint}
          style={styles.composerInput}
          multiline
        />
        <TouchableOpacity
          onPress={submit}
          disabled={!draft.trim() || busy}
          style={[styles.send, (!draft.trim() || busy) && { opacity: 0.4 }]}
        >
          <Text style={styles.sendText}>↑</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function MessageRow({ msg }: { msg: ChatMsg }) {
  if (msg.role === "reasoning") return null;
  if (msg.role === "user") {
    return (
      <View style={styles.userWrap}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{msg.text}</Text>
        </View>
      </View>
    );
  }
  if (msg.role === "tool") {
    const icon = TOOL_ICON[msg.tool ?? ""] ?? "🔧";
    const detail = msg.target?.split("/").pop() ?? msg.target ?? "";
    return (
      <View style={styles.toolRow}>
        <Text style={styles.toolText}>
          {icon} {msg.tool} {detail ? <Text style={styles.toolTarget}>{detail}</Text> : null}
        </Text>
      </View>
    );
  }
  if (!msg.text) return null;
  return (
    <View style={styles.agentWrap}>
      <Text style={styles.agentSparkle}>✦</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.agentText}>{msg.text}</Text>
        {msg.usage ? (
          <Text style={styles.usage}>
            {shortModel(msg.usage.model)} · ${msg.usage.costUsd < 0.01 ? msg.usage.costUsd.toFixed(3) : msg.usage.costUsd.toFixed(2)} ·{" "}
            {(msg.usage.durationMs / 1000).toFixed(1)}s
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function shortModel(model: string | null): string {
  if (!model) return "agent";
  return model.replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/\[.*\]$/, "");
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  pickHeading: { color: colors.textMuted, fontSize: 12, textTransform: "uppercase", letterSpacing: 1, marginBottom: space(1) },
  emptySub: { color: colors.textMuted, fontSize: 13, lineHeight: 18, padding: space(2) },
  wsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space(3.5),
    paddingVertical: space(3.5),
  },
  wsName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  wsBranch: { color: colors.textFaint, fontSize: 12 },
  workingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.amber },
  wsChevron: { marginLeft: "auto", color: colors.textFaint, fontSize: 22 },
  chatHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: space(2),
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    borderBottomWidth: 1,
    borderBottomColor: colors.cardBorder,
  },
  back: { color: colors.sky, fontSize: 14 },
  chatTitle: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  transcript: { flex: 1 },
  userWrap: { alignItems: "flex-end" },
  userBubble: { maxWidth: "85%", backgroundColor: colors.primary, borderRadius: radius.md, paddingHorizontal: space(3), paddingVertical: space(2) },
  userText: { color: "#0a0a0b", fontSize: 14 },
  toolRow: { backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: space(2.5), paddingVertical: space(1.5) },
  toolText: { color: colors.textMuted, fontSize: 12 },
  toolTarget: { color: colors.textFaint, fontFamily: "monospace" },
  agentWrap: { flexDirection: "row", gap: space(2) },
  agentSparkle: { color: colors.emerald, fontSize: 14, marginTop: space(0.5) },
  agentText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  usage: { color: colors.textFaint, fontSize: 11, marginTop: space(1) },
  composer: { flexDirection: "row", alignItems: "flex-end", gap: space(2), padding: space(2.5), borderTopWidth: 1, borderTopColor: colors.cardBorder },
  composerInput: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: 14,
  },
  send: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  sendText: { color: "#0a0a0b", fontSize: 20, fontWeight: "700" },
});
