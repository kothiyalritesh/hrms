module.exports = function (api) {
  const isProduction = api.env("production");
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      [
        "module-resolver",
        {
          root: ["./"],
          alias: {
            "@": "./",
          },
          extensions: [".ios.js", ".android.js", ".js", ".ts", ".tsx", ".json"],
        },
      ],
      ...(isProduction ? ["./scripts/remove-console.babel.js"] : []),
      "react-native-reanimated/plugin",
    ],
  };
};
