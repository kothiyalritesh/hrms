// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ["dist/*"],
    rules: {
      // Reanimated SharedValue.value is intentionally mutable. React's generic
      // immutability rule cannot distinguish it from React state.
      "react-hooks/immutability": "off",
      // Modal form state is deliberately reset when a modal becomes visible.
      // The React 19 heuristic flags this established React Native pattern.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
