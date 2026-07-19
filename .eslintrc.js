module.exports = {
  extends: ["expo"],
  env: {
    node: true,
  },
  rules: {
    "react-hooks/immutability": "off",
    "react-hooks/preserve-manual-memoization": "off",
    "react-hooks/refs": "off",
    "react-hooks/set-state-in-effect": "off",
  },
  ignorePatterns: [
    "dist/**",
    "components/GluestackInitializer.tsx",
    "components/ui/**",
    "components/colors/**",
    "services/gameService.ts",
    "services/homeFeedService.ts",
    "functions/**",
    ".expo/**",
    "node_modules/**"
  ],
};
