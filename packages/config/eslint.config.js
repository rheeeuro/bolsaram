// @bolsaram/config — 워크스페이스 공통 ESLint 규칙.
// 품질 규칙(부트스트랩 프롬프트 §품질 규칙)을 lint 로 강제한다.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** @type {import("eslint").Linter.Config[]} */
export const base = [
  { ignores: ["**/dist/**", "**/.next/**", "**/node_modules/**", "**/coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `any` 남용 금지 — 명시적으로 필요한 곳은 eslint-disable 과 이유를 쓴다.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // 에러를 삼키지 않는다.
      "no-empty": ["error", { allowEmptyCatch: false }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
];

export default base;
