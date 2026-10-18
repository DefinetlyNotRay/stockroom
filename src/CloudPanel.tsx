import React, { useRef, useState } from "react";
import {
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { cloud, importPhoneInventory } from "./cloud";
export default function CloudPanel({
  account,
  onRefresh,
  pendingCount = 0,
  syncing = false,
  onDiscardPending,
  authenticated = true,
  onSignOut,
}: {
  account: string | null;
  onRefresh: () => Promise<void>;
  pendingCount?: number;
  syncing?: boolean;
  onDiscardPending?: () => Promise<void>;
  authenticated?: boolean;
  onSignOut?: () => Promise<void>;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [creating, setCreating] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState("");
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(action: () => Promise<void>) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not connect.");
    } finally {
      working.current = false;
      setBusy(false);
    }
  }
  if (!cloud) return <Text style={s.hint}>Cloud is not configured.</Text>;
  if (account && authenticated)
    return (
      <View style={{ gap: 12 }}>
        <Text style={s.hint}>Signed in</Text>
        <Pressable
          accessibilityRole="button"
          disabled={busy || syncing}
          style={s.button}
          onPress={() =>
            run(async () => {
              await onRefresh();
              setMessage("Data synced.");
            })
          }
        >
          <Text style={s.buttonText}>{syncing ? "Syncing…" : "Sync Data"}</Text>
        </Pressable>
        {pendingCount > 0 && <Text style={s.hint}>{pendingCount} pending</Text>}
        <Pressable
          disabled={busy || syncing || pendingCount > 0}
          style={[s.button, { backgroundColor: "#E4EBD9" }]}
          onPress={() =>
            Alert.alert(
              "Import phone stock?",
              "Copy local stock to an empty cloud account?",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Import",
                  onPress: () =>
                    run(async () => {
                      await importPhoneInventory();
                      await onRefresh();
                      setMessage("Imported.");
                    }),
                },
              ],
            )
          }
        >
          <Text style={[s.buttonText, { color: "#184D3E" }]}>
            Import phone stock
          </Text>
        </Pressable>
        <Pressable
          disabled={busy || syncing || pendingCount > 0}
          style={[s.button, { backgroundColor: "#E4EBD9" }]}
          onPress={() =>
            run(async () => {
              if (onSignOut) await onSignOut();
              else {
                const { error } = await cloud!.auth.signOut();
                if (error) throw error;
              }
              setMessage("Signed out.");
            })
          }
        >
          <Text style={[s.buttonText, { color: "#184D3E" }]}>Sign out</Text>
        </Pressable>
        {pendingCount > 0 && (
          <Text style={s.hint}>Sync before signing out.</Text>
        )}
        {pendingCount > 0 && onDiscardPending && (
          <Pressable
            accessibilityRole="button"
            disabled={busy || syncing}
            style={[s.button, { backgroundColor: "#F7EBDD" }]}
            onPress={() =>
              Alert.alert(
                "Discard pending changes?",
                `Discard ${pendingCount} pending entries and reload cloud stock? Requires internet.`,
                [
                  { text: "Keep entries", style: "cancel" },
                  {
                    text: "Discard pending changes",
                    style: "destructive",
                    onPress: () =>
                      run(async () => {
                        await onDiscardPending();
                        setMessage("Cloud stock restored.");
                      }),
                  },
                ],
              )
            }
          >
            <Text style={[s.buttonText, { color: "#94601B" }]}>
              Discard pending changes
            </Text>
          </Pressable>
        )}
        {(busy || message) && (
          <Text accessibilityRole="alert" style={s.hint}>
            {busy ? "Connecting…" : message}
          </Text>
        )}
      </View>
    );
  return (
    <View style={{ gap: 12 }}>
      {!!account && <Text style={s.hint}>Sign in again to sync.</Text>}
      <TextInput
        accessibilityLabel="Email"
        style={s.input}
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        placeholderTextColor="#000000"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        editable={!busy}
      />
      <TextInput
        accessibilityLabel="Password"
        style={s.input}
        value={password}
        onChangeText={setPassword}
        placeholder="Password"
        placeholderTextColor="#000000"
        secureTextEntry
        autoCapitalize="none"
        autoComplete={creating ? "new-password" : "current-password"}
        editable={!busy}
      />
      {creating && (
        <TextInput
          accessibilityLabel="Confirm password"
          style={s.input}
          value={confirmation}
          onChangeText={setConfirmation}
          placeholder="Confirm password"
          placeholderTextColor="#000000"
          secureTextEntry
          autoCapitalize="none"
          autoComplete="new-password"
          editable={!busy}
        />
      )}
      <Pressable
        disabled={busy}
        style={s.button}
        onPress={() =>
          run(async () => {
            if (!email.trim() || !password)
              throw Error("Enter your email and password.");
            if (creating) {
              if (password !== confirmation)
                throw Error("Passwords do not match.");
              const { data, error } = await cloud!.auth.signUp({
                email: email.trim(),
                password,
              });
              if (error) throw error;
              setPassword("");
              setConfirmation("");
              if (!data.session) {
                setConfirmationEmail(email.trim());
                setCreating(false);
                setMessage(
                  "Check your email to confirm your account, then sign in.",
                );
              }
              return;
            }
            const { error } = await cloud!.auth.signInWithPassword({
              email: email.trim(),
              password,
            });
            if (error) throw error;
            setPassword("");
            setMessage("Signed in.");
          })
        }
      >
        <Text style={s.buttonText}>
          {busy ? "Connecting…" : creating ? "Create account" : "Sign in"}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        style={[s.button, { backgroundColor: "#E4EBD9" }]}
        onPress={() => {
          setCreating(!creating);
          setConfirmation("");
          setMessage("");
        }}
      >
        <Text style={[s.buttonText, { color: "#184D3E" }]}>
          {creating ? "Back to sign in" : "Create an account"}
        </Text>
      </Pressable>
      {!!confirmationEmail && !creating && (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          style={{ minHeight: 48, justifyContent: "center" }}
          onPress={() =>
            run(async () => {
              const { error } = await cloud!.auth.resend({
                type: "signup",
                email: confirmationEmail,
              });
              if (error) throw error;
              setMessage("Confirmation email sent.");
            })
          }
        >
          <Text style={{ color: "#184D3E" }}>Resend confirmation</Text>
        </Pressable>
      )}
      {(busy || message) && (
        <Text accessibilityRole="alert" style={s.hint}>
          {busy ? "Connecting…" : message}
        </Text>
      )}
    </View>
  );
}
const s = StyleSheet.create({
  input: {
    color: "#000000",
    backgroundColor: "#FFFDF8",
    borderWidth: 1,
    borderColor: "#D9DED2",
    borderRadius: 14,
    padding: 16,
    minHeight: 54,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#184D3E",
    padding: 16,
    minHeight: 54,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "600" },
  hint: { fontSize: 12, color: "#778078", lineHeight: 18 },
});
