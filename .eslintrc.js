module.exports = {
  extends: ["expo"],
  env: {
    node: true,
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