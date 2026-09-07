import next from "@next/eslint-plugin-next";
import base from "@bolsaram/config/eslint";

export default [
  ...base,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { "@next/next": next },
    rules: {
      ...next.configs.recommended.rules,
      // signed URL 은 짧게 만료되므로 next/image 최적화 캐시와 맞지 않는다.
      // 이미지마다 개별 eslint-disable 로 이유를 남기고 있어 규칙은 켜둔다.
    },
  },
  {
    files: ["src/**/*.tsx"],
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
];
