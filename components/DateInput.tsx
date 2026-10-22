import React from "react";
import { Platform, StyleProp, StyleSheet, TextInput, TextStyle } from "react-native";

type Props = {
  value: string; // YYYY-MM-DD or ""
  onChange: (value: string) => void;
  style?: StyleProp<TextStyle>;
  placeholder?: string;
  placeholderTextColor?: string;
  min?: string;
  max?: string;
};

/**
 * Date field that uses the browser's native date picker on web (desktop
 * browsers, iPhone Safari and the Android app's WebView) and a YYYY-MM-DD text
 * field elsewhere. The value is always an ISO business date string.
 */
export function DateInput({
  value,
  onChange,
  style,
  placeholder = "YYYY-MM-DD",
  placeholderTextColor,
  min,
  max,
}: Props) {
  if (Platform.OS === "web") {
    const flat = (StyleSheet.flatten(style) || {}) as any;
    return React.createElement("input", {
      type: "date",
      value: value || "",
      min,
      max,
      onChange: (event: any) => onChange(String(event?.target?.value ?? "")),
      style: {
        fontFamily: "inherit",
        fontSize: 16, // iPhone Safari zooms into smaller inputs
        boxSizing: "border-box",
        width: "100%",
        minHeight: 42,
        background: "transparent",
        borderStyle: "solid",
        ...flat,
      },
    });
  }
  return (
    <TextInput
      style={style}
      placeholder={placeholder}
      placeholderTextColor={placeholderTextColor}
      value={value}
      onChangeText={onChange}
      keyboardType="numbers-and-punctuation"
      maxLength={10}
    />
  );
}

export default DateInput;
