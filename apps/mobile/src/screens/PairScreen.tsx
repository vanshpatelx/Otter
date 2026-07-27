import { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from "react-native";
import { Logo } from "../components/Logo";
import { colors, radius, space } from "../theme";
import type { WorkerTarget } from "../lib/useWorker";

/**
 * The pairing screen — the app's front door.
 *
 * A phone reaches a workstation the same way the Desktop does: its address plus
 * the code from `otter worker status`. Kept deliberately plain so the first thing
 * a new user does is obvious.
 */
export function PairScreen({ onPair }: { onPair: (t: WorkerTarget) => void }) {
  const [url, setUrl] = useState("ws://");
  const [code, setCode] = useState("");
  const canConnect = url.trim().length > 6 && code.trim().length > 0;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={styles.root}
    >
      <View style={styles.card}>
        <View style={styles.logoChip}>
          <Logo size={30} color={colors.navy} />
        </View>
        <Text style={styles.title}>Welcome to Otter</Text>
        <Text style={styles.subtitle}>
          Watch and approve your AI agents from your phone. Pair a workstation to start.
        </Text>

        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="ws://192.168.1.10:4501"
          placeholderTextColor={colors.textFaint}
          style={styles.input}
        />
        <TextInput
          value={code}
          onChangeText={(t) => setCode(t.toUpperCase())}
          autoCapitalize="characters"
          autoCorrect={false}
          placeholder="OTTER-XXXX-XXXX"
          placeholderTextColor={colors.textFaint}
          style={[styles.input, styles.code]}
        />
        <TouchableOpacity
          disabled={!canConnect}
          onPress={() => onPair({ url: url.trim(), token: code.trim() })}
          style={[styles.button, !canConnect && styles.buttonOff]}
        >
          <Text style={styles.buttonText}>Connect</Text>
        </TouchableOpacity>

        <Text style={styles.hint}>
          Run <Text style={styles.mono}>otter worker start</Text> on a machine, then enter its address
          and code above.
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: space(5) },
  card: {
    width: "100%",
    maxWidth: 380,
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space(6),
    alignItems: "center",
  },
  logoChip: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space(3),
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  subtitle: { color: colors.textMuted, fontSize: 13, textAlign: "center", marginTop: space(1.5), marginBottom: space(4), lineHeight: 18 },
  input: {
    width: "100%",
    backgroundColor: colors.bg,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text,
    paddingHorizontal: space(3),
    paddingVertical: space(2.5),
    fontSize: 14,
    marginBottom: space(2.5),
  },
  code: { textAlign: "center", letterSpacing: 3, fontVariant: ["tabular-nums"] },
  button: {
    width: "100%",
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: space(3),
    alignItems: "center",
  },
  buttonOff: { opacity: 0.4 },
  buttonText: { color: "#0a0a0b", fontWeight: "700", fontSize: 15 },
  hint: { color: colors.textFaint, fontSize: 11, textAlign: "center", marginTop: space(3), lineHeight: 16 },
  mono: { fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace", color: colors.textMuted },
});
