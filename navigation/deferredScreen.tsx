import React from "react";
import { ActivityIndicator, View } from "react-native";

export function deferredScreen<T extends React.ComponentType<any>>(
  loader: () => Promise<{ default: T }>,
) {
  const Lazy = React.lazy(loader);
  return function DeferredScreen(props: React.ComponentProps<T>) {
    return (
      <React.Suspense
        fallback={
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
            <ActivityIndicator />
          </View>
        }
      >
        <Lazy {...props} />
      </React.Suspense>
    );
  };
}
