/**
 * ModuleErrorBoundary
 * Isolates render-cycle crashes in heavy HRMS modules so one broken screen
 * never brings down the rest of the application.
 */
import React, { Component, PropsWithChildren } from "react";
import { View, StyleSheet } from "react-native";
import { ThemedText } from "@/components/ThemedText";

interface ModuleErrorBoundaryProps extends PropsWithChildren {
  /** Module name shown to the user in the fallback UI */
  moduleName?: string;
}

interface ModuleErrorBoundaryState {
  error: Error | null;
}

export class ModuleErrorBoundary extends Component<
  ModuleErrorBoundaryProps,
  ModuleErrorBoundaryState
> {
  state: ModuleErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ModuleErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }): void {
    // Non-fatal – logged to console only; replaced later with reportNonFatalError
    console.warn(
      `[ModuleErrorBoundary] ${this.props.moduleName ?? "Module"} crashed:`,
      error,
      info.componentStack,
    );
  }

  resetError = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return (
        <View style={styles.container}>
          <ThemedText style={styles.title}>
            {this.props.moduleName ?? "Module"} failed to load
          </ThemedText>
          <ThemedText
            type="caption"
            style={styles.subtitle}
            onPress={this.resetError}
          >
            {this.state.error.message}
          </ThemedText>
          <ThemedText type="caption" style={styles.retry} onPress={this.resetError}>
            Tap to retry
          </ThemedText>
        </View>
      );
    }
    return <>{this.props.children}</>;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 8,
  },
  title: {
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    textAlign: "center",
    opacity: 0.6,
  },
  retry: {
    marginTop: 8,
    color: "#3B82F6",
    fontWeight: "600",
  },
});

