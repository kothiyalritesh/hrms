import React, { useEffect, useState } from "react";
import {
  Alert,
  AlertButton,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

/**
 * react-native-web ships `Alert.alert` as an empty function, so on the web
 * build (browsers AND the Android app, which renders the web build) every
 * Alert.alert in the app was silently dropped: validation errors never
 * appeared and confirm buttons ("Remove", "Confirm", ...) could never be
 * pressed. This host replaces Alert.alert on web with an in-app dialog that
 * supports title, message and buttons (cancel / destructive styles), queued in
 * call order. Native platforms keep the real Alert.
 */

type PendingAlert = {
  id: number;
  title: string;
  message?: string;
  buttons: AlertButton[];
  cancelable: boolean;
  onDismiss?: () => void;
};

let nextId = 1;
let queue: PendingAlert[] = [];
let listener: ((items: PendingAlert[]) => void) | null = null;

function publish() {
  listener?.(queue);
}

function enqueue(
  title: string,
  message?: string,
  buttons?: AlertButton[],
  options?: { cancelable?: boolean; onDismiss?: () => void },
) {
  const item: PendingAlert = {
    id: nextId++,
    title: String(title ?? ""),
    message: message == null ? undefined : String(message),
    buttons: buttons && buttons.length ? buttons : [{ text: "OK" }],
    cancelable: options?.cancelable ?? true,
    onDismiss: options?.onDismiss,
  };
  if (!listener && typeof window !== "undefined") {
    // Host not mounted (very early boot): fall back to the browser dialog.
    const text = [item.title, item.message].filter(Boolean).join("\n\n");
    if (item.buttons.length > 1) {
      const confirmed = window.confirm(text);
      const cancel = item.buttons.find((b) => b.style === "cancel");
      const action = item.buttons.find((b) => b.style !== "cancel") ?? item.buttons[0];
      (confirmed ? action : cancel)?.onPress?.();
    } else {
      window.alert(text);
      item.buttons[0]?.onPress?.();
    }
    return;
  }
  queue = [...queue, item];
  publish();
}

if (Platform.OS === "web") {
  (Alert as any).alert = enqueue;
}

export default function WebAlertHost() {
  const [items, setItems] = useState<PendingAlert[]>(queue);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    listener = setItems;
    setItems(queue);
    return () => {
      if (listener === setItems) listener = null;
    };
  }, []);

  if (Platform.OS !== "web") return null;
  const current = items[0];
  if (!current) return null;

  const close = (button?: AlertButton) => {
    queue = queue.filter((item) => item.id !== current.id);
    publish();
    // Run the handler after the dialog is gone so a follow-up Alert.alert
    // inside it is queued behind (not replaced by) this one.
    setTimeout(() => {
      if (button) button.onPress?.();
      else current.onDismiss?.();
    }, 0);
  };

  const cancelButton = current.buttons.find((b) => b.style === "cancel");
  const onBackdrop = () => {
    if (!current.cancelable) return;
    if (cancelButton) close(cancelButton);
    else if (current.buttons.length === 1) close(current.buttons[0]);
    else close();
  };
  const stacked = current.buttons.length > 2;

  return (
    <Modal
      key={current.id}
      transparent
      visible
      animationType="fade"
      onRequestClose={onBackdrop}
    >
      <Pressable style={styles.backdrop} onPress={onBackdrop}>
        <Pressable style={styles.card} onPress={() => undefined}>
          {current.title ? <Text style={styles.title}>{current.title}</Text> : null}
          {current.message ? (
            <ScrollView style={styles.messageScroll}>
              <Text style={styles.message}>{current.message}</Text>
            </ScrollView>
          ) : null}
          <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
            {current.buttons.map((button, index) => {
              const primary =
                button.style !== "cancel" && index === current.buttons.length - 1;
              const destructive = button.style === "destructive";
              return (
                <Pressable
                  key={`${button.text}-${index}`}
                  accessibilityRole="button"
                  onPress={() => close(button)}
                  style={({ pressed }) => [
                    styles.button,
                    stacked && styles.buttonStacked,
                    primary && !destructive && styles.buttonPrimary,
                    destructive && styles.buttonDestructive,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      (primary || destructive) && styles.buttonTextOnColor,
                    ]}
                  >
                    {button.text ?? "OK"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
    gap: 10,
    boxShadow: "0 12px 32px rgba(0,0,0,0.18)",
  } as any,
  title: { fontSize: 17, fontWeight: "700", color: "#111827" },
  messageScroll: { maxHeight: 320 },
  message: { fontSize: 14, lineHeight: 20, color: "#374151" },
  buttons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  },
  buttonsStacked: { flexDirection: "column", alignItems: "stretch" },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
    alignItems: "center",
  },
  buttonStacked: { width: "100%" },
  buttonPrimary: { backgroundColor: "#6D1B6D" },
  buttonDestructive: { backgroundColor: "#DC2626" },
  buttonText: { fontSize: 14, fontWeight: "700", color: "#374151" },
  buttonTextOnColor: { color: "#FFFFFF" },
});
