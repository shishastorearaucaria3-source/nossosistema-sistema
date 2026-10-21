import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "out/**",
      "dist-final/**",
      "dist-setup/**",
      "release/**",
      "backups/**",
      "homologacao/**",
      "nexbackuptotal/**",
      "catalogo/**",
      "catalogo-worker/**",
      "**/*.d.ts",
    ],
  },

  js.configs.recommended,

  ...tseslint.configs.recommended,

  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        console: "readonly",
        fetch: "readonly",
        alert: "readonly",
        confirm: "readonly",
      },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react-refresh/only-export-components": "warn",
    },
  },

  {
    files: [
      "src/main/**/*.{ts,tsx}",
      "src/server/**/*.{ts,tsx}",
      "src/shared/**/*.{ts,tsx}",
      "src/whatsapp/**/*.{ts,tsx}",
      "src/setup-launcher/**/*.{ts,tsx}",
      "src/servidor-exe/**/*.{ts,tsx}",
    ],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
  },

  {
    files: [
      "src/panel-servidor/**/*.js",
      "src/setup-launcher/**/*.js",
    ],
    languageOptions: {
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        process: "readonly",
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        confirm: "readonly",
      },
    },
  },

  {
    files: ["src/**/*.ts", "src/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-empty-object-type": "warn",
    },
  }
);
