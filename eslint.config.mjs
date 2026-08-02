import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    // Vendored chrome components are upstream code — the registry is the place
    // to fix them, and a local edit here would show as drift in `chrome diff`.
    // These are the two relaxations the library documents for its own sources:
    // hooks read refs during render for scroll sync, and several components
    // sync browser-only state on mount.
    files: ["src/components/chrome/**", "src/hooks/**"],
    rules: {
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
  {
    // Async Server Components render once per request, so reading the clock in
    // them is request-scoped, not an impurity that can desync a re-render.
    // react-hooks/purity is aimed at client components and can't tell the two
    // apart; every page here is `force-dynamic` and genuinely needs the time.
    files: ["src/app/**/page.tsx", "src/app/**/layout.tsx", "src/app/**/route.ts"],
    rules: {
      "react-hooks/purity": "off",
    },
  },
]);

export default eslintConfig;
