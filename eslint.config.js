import tseslint from "typescript-eslint";
export default [
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      "work/**",
      "attachments/**",
      "node_modules/**",
    ],
  },
  ...tseslint.configs.recommended,
];
