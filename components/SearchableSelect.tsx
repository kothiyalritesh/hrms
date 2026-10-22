import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Feather from "@expo/vector-icons/Feather";
import { ThemedText } from "@/components/ThemedText";
import { useTheme } from "@/hooks/useTheme";

export type SelectOption = {
  /** Value passed to onChange. */
  value: string;
  label: string;
  /** Section heading, e.g. "Offices". Options keep their given order. */
  group?: string;
  subtitle?: string;
  /** Alias of `subtitle`. */
  sublabel?: string;
  icon?: keyof typeof Feather.glyphMap;
};

/** Also accepts `{ id, label, sublabel }` options; `id` is used as the value. */
export type SearchableSelectOption = Omit<SelectOption, "value"> & { value?: string; id?: string };

type CreateResult = string | null | undefined | void;

type Props = {
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  /** Title of the picker sheet (defaults to the placeholder). */
  title?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  /**
   * Let the user use what they typed when nothing matches exactly.
   * Text that equals an existing option (ignoring case and extra spaces)
   * always picks that option instead, so near-duplicates are never created.
   */
  allowCustom?: boolean;
  /**
   * Called with the cleaned custom text. Return the value to select (or call
   * onChange yourself). Throw to keep the sheet open and show the error.
   * Without it, the custom text itself is passed to onChange.
   */
  onCreateCustom?: (text: string) => CreateResult | Promise<CreateResult>;
  /** Label of the custom row, e.g. (t) => `Create team “${t}”`. */
  customLabel?: (text: string) => string;
  loading?: boolean;
  /** Show a "clear" row so the field can be emptied. */
  clearable?: boolean;
  clearLabel?: string;
  disabled?: boolean;
};

type Row =
  | { kind: "header"; key: string; label: string; count: number }
  | { kind: "option"; key: string; option: SearchableSelectOption; pick: number }
  | { kind: "custom"; key: string; text: string; pick: number }
  | { kind: "clear"; key: string; pick: number };

const optionValue = (option: SearchableSelectOption) => option.value ?? option.id ?? option.label;
const optionSubtitle = (option: SearchableSelectOption) => option.subtitle ?? option.sublabel;

/** Trims and collapses inner whitespace: "  Noida   Sales " -> "Noida Sales". */
export function cleanChoiceText(text: string): string {
  return String(text ?? "").trim().replace(/\s+/g, " ");
}

/** Same choice ignoring case and whitespace differences. */
export function sameChoiceText(a: string, b: string): boolean {
  return cleanChoiceText(a).toLowerCase() === cleanChoiceText(b).toLowerCase();
}

/**
 * A field that opens a searchable, grouped option sheet. Replaces the native
 * <select>/Picker, which on web renders an unstyled browser dropdown that is
 * hard to read and impossible to search with hundreds of employees.
 *
 * Typing filters instantly (case-insensitive, matches anywhere). On web the
 * arrow keys move the highlight, Enter picks it and Escape closes. With
 * `allowCustom` the typed text can be used (or created) when nothing matches.
 */
export function SearchableSelect({
  value,
  options,
  onChange,
  title,
  placeholder = "Select",
  searchPlaceholder = "Search",
  allowCustom = false,
  onCreateCustom,
  customLabel,
  loading = false,
  clearable = false,
  clearLabel = "Clear selection",
  disabled = false,
}: Props) {
  const { theme } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const sheet = width < 600; // phones: bottom sheet, desktop: centred dialog
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const listRef = useRef<FlatList<Row>>(null);
  const sheetTitle = title ?? placeholder;

  const selected: SearchableSelectOption | undefined = useMemo(() => {
    const found = options.find((option) => optionValue(option) === value);
    if (found) return found;
    // A custom value that is not (yet) in the list still shows as selected.
    return allowCustom && value ? { value, label: value } : undefined;
  }, [options, value, allowCustom]);

  const rows = useMemo<Row[]>(() => {
    const q = query.trim().toLowerCase();
    const matches = q
      ? options.filter((option) =>
          `${option.label} ${optionSubtitle(option) ?? ""} ${option.group ?? ""}`.toLowerCase().includes(q),
        )
      : options;
    const out: Row[] = [];
    let pick = 0;
    if (clearable && value && !q) {
      out.push({ kind: "clear", key: "clear", pick: pick++ });
    }
    const counts = new Map<string, number>();
    for (const option of matches) {
      const group = option.group ?? "";
      counts.set(group, (counts.get(group) ?? 0) + 1);
    }
    let lastGroup: string | undefined;
    for (const option of matches) {
      const group = option.group ?? "";
      if (group && group !== lastGroup) {
        out.push({ kind: "header", key: `h:${group}`, label: group, count: counts.get(group) ?? 0 });
      }
      lastGroup = group;
      out.push({ kind: "option", key: `o:${optionValue(option)}`, option, pick: pick++ });
    }
    const text = cleanChoiceText(query);
    if (allowCustom && text && !options.some((option) => sameChoiceText(option.label, text))) {
      out.push({ kind: "custom", key: "custom", text, pick: pick++ });
    }
    return out;
  }, [options, query, allowCustom, clearable, value]);

  const pickCount = useMemo(
    () => rows.reduce((n, row) => (row.kind === "header" ? n : n + 1), 0),
    [rows],
  );

  useEffect(() => {
    setActive(0);
    setCreateError(null);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const index = rows.findIndex((row) => row.kind !== "header" && row.pick === active);
    if (index < 0) return;
    try {
      listRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: false });
    } catch {
      // Row not measured yet; the highlight is still correct.
    }
  }, [active, open, rows]);

  const close = () => {
    if (creating) return;
    setOpen(false);
    setQuery("");
    setCreateError(null);
  };

  const pickCustom = async (raw: string) => {
    const text = cleanChoiceText(raw);
    if (!text || creating) return;
    const existing = options.find((option) => sameChoiceText(option.label, text));
    if (existing) {
      onChange(optionValue(existing));
      close();
      return;
    }
    if (!onCreateCustom) {
      onChange(text);
      close();
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const result = await onCreateCustom(text);
      if (typeof result === "string" && result) onChange(result);
      setCreating(false);
      setOpen(false);
      setQuery("");
    } catch (error: any) {
      setCreating(false);
      setCreateError(error?.message || "Could not add this value. Please try again.");
    }
  };

  const choose = (row: Row | undefined) => {
    if (!row || row.kind === "header") return;
    if (row.kind === "custom") {
      void pickCustom(row.text);
      return;
    }
    if (row.kind === "clear") onChange("");
    else onChange(optionValue(row.option));
    close();
  };

  const chooseActive = () => {
    choose(rows.find((row) => row.kind !== "header" && row.pick === active));
  };

  const onKeyPress = (event: any) => {
    const key = event?.nativeEvent?.key;
    if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault?.();
      if (pickCount === 0) return;
      setActive((current) =>
        key === "ArrowDown" ? (current + 1) % pickCount : (current - 1 + pickCount) % pickCount,
      );
    } else if (key === "Escape") {
      event.preventDefault?.();
      close();
    }
  };

  const content = (
    <Pressable style={[styles.backdrop, sheet && styles.backdropSheet]} onPress={close}>
      <Pressable
        style={[
          styles.sheet,
          sheet && [styles.sheetBottom, { paddingBottom: 12 + insets.bottom }],
          { backgroundColor: theme.backgroundDefault },
        ]}
        onPress={() => undefined}
      >
        {sheet ? <View style={[styles.grabber, { backgroundColor: theme.border }]} /> : null}
        <View style={styles.sheetHeader}>
          <ThemedText style={styles.sheetTitle} numberOfLines={1}>{sheetTitle}</ThemedText>
          <Pressable accessibilityLabel="Close" onPress={close} hitSlop={10}>
            <Feather name="x" size={22} color={theme.textSecondary} />
          </Pressable>
        </View>
        <View style={[styles.search, { borderColor: theme.border, backgroundColor: theme.backgroundSecondary }]}>
          <Feather name="search" size={16} color={theme.textSecondary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={searchPlaceholder}
            placeholderTextColor={theme.textSecondary}
            autoFocus={allowCustom || (Platform.OS === "web" && !sheet)}
            autoCorrect={false}
            autoCapitalize={allowCustom ? "words" : "none"}
            returnKeyType="done"
            blurOnSubmit={false}
            onSubmitEditing={chooseActive}
            onKeyPress={onKeyPress}
            accessibilityLabel={searchPlaceholder}
            style={[styles.searchInput, { color: theme.text }]}
          />
          {loading || creating ? (
            <ActivityIndicator size="small" color={theme.primary} />
          ) : query ? (
            <Pressable accessibilityLabel="Clear search" onPress={() => setQuery("")} hitSlop={8}>
              <Feather name="x-circle" size={16} color={theme.textSecondary} />
            </Pressable>
          ) : null}
        </View>
        {createError ? (
          <ThemedText type="caption" style={{ color: theme.error, marginBottom: 6 }}>
            {createError}
          </ThemedText>
        ) : null}
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => row.key}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={30}
          style={{ flexGrow: 0 }}
          onScrollToIndexFailed={() => undefined}
          ListEmptyComponent={
            <ThemedText style={{ color: theme.textSecondary, textAlign: "center", padding: 24 }}>
              {loading ? "Loading…" : query ? `No matches for "${query}"` : "Nothing to choose yet"}
            </ThemedText>
          }
          renderItem={({ item }) => {
            if (item.kind === "header") {
              return (
                <ThemedText style={[styles.groupLabel, { color: theme.textSecondary }]}>
                  {item.label.toUpperCase()} · {item.count}
                </ThemedText>
              );
            }
            const highlighted = item.pick === active;
            const isSelected = item.kind === "option" && optionValue(item.option) === value;
            const icon: keyof typeof Feather.glyphMap =
              item.kind === "custom" ? "plus" : item.kind === "clear" ? "slash" : item.option.icon ?? "circle";
            const label =
              item.kind === "custom"
                ? customLabel
                  ? customLabel(item.text)
                  : `Use “${item.text}”`
                : item.kind === "clear"
                  ? clearLabel
                  : item.option.label;
            const subtitle = item.kind === "option" ? optionSubtitle(item.option) : undefined;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                disabled={creating}
                onPress={() => choose(item)}
                onHoverIn={() => setActive(item.pick)}
                style={({ pressed }) => [
                  styles.option,
                  {
                    backgroundColor: isSelected
                      ? theme.primary + "14"
                      : pressed || highlighted
                        ? theme.backgroundSecondary
                        : "transparent",
                  },
                ]}
              >
                <View
                  style={[
                    styles.optionIcon,
                    { backgroundColor: theme.primary + (isSelected || item.kind === "custom" ? "26" : "12") },
                  ]}
                >
                  <Feather name={icon} size={14} color={theme.primary} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <ThemedText
                    numberOfLines={1}
                    style={{
                      color: item.kind === "custom" ? theme.primary : theme.text,
                      fontWeight: isSelected || item.kind === "custom" ? "700" : "500",
                    }}
                  >
                    {label}
                  </ThemedText>
                  {subtitle ? (
                    <ThemedText type="caption" numberOfLines={1} style={{ color: theme.textSecondary }}>
                      {subtitle}
                    </ThemedText>
                  ) : null}
                </View>
                {isSelected ? <Feather name="check" size={18} color={theme.primary} /> : null}
              </Pressable>
            );
          }}
        />
      </Pressable>
    </Pressable>
  );

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${sheetTitle}: ${selected?.label ?? placeholder}`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [
          styles.field,
          {
            borderColor: theme.border,
            backgroundColor: theme.backgroundSecondary,
            opacity: disabled ? 0.6 : pressed ? 0.85 : 1,
          },
        ]}
      >
        {selected?.icon ? (
          <Feather name={selected.icon} size={16} color={theme.primary} />
        ) : null}
        <View style={{ flex: 1, minWidth: 0 }}>
          <ThemedText numberOfLines={1} style={{ color: selected ? theme.text : theme.textSecondary, fontWeight: "600" }}>
            {selected?.label ?? placeholder}
          </ThemedText>
          {selected?.group ? (
            <ThemedText type="caption" numberOfLines={1} style={{ color: theme.textSecondary }}>
              {selected.group}
            </ThemedText>
          ) : null}
        </View>
        {loading ? (
          <ActivityIndicator size="small" color={theme.textSecondary} />
        ) : (
          <Feather name="chevron-down" size={18} color={theme.textSecondary} />
        )}
      </Pressable>

      {open ? (
        <Modal transparent visible animationType={sheet ? "slide" : "fade"} onRequestClose={close}>
          {Platform.OS === "ios" ? (
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
              {content}
            </KeyboardAvoidingView>
          ) : (
            content
          )}
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 48,
    marginBottom: 12,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.45)",
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  sheet: {
    width: "100%",
    maxWidth: 480,
    maxHeight: "80%",
    borderRadius: 16,
    padding: 16,
    overflow: "hidden",
  },
  backdropSheet: { justifyContent: "flex-end", padding: 0 },
  sheetBottom: {
    maxWidth: "100%",
    maxHeight: "85%",
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    paddingTop: 8,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  sheetTitle: { flex: 1, fontSize: 17, fontWeight: "800" },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  // 16px: iPhone Safari zooms into any smaller input on focus
  searchInput: { flex: 1, minWidth: 0, paddingVertical: 11, fontSize: 16, outlineStyle: "none" } as any,
  groupLabel: { fontSize: 11, fontWeight: "800", letterSpacing: 0.6, marginTop: 12, marginBottom: 4, paddingHorizontal: 4 },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 8,
    paddingVertical: 9,
    minHeight: 48,
    borderRadius: 10,
  },
  optionIcon: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
});

export default SearchableSelect;
