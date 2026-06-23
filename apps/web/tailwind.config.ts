import type { Config } from "tailwindcss";
export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0B0E14", surface: "#11161F", surface2: "#161C28",
        hair: "#222B3A", ink: "#E6EAF2", muted: "#8A94A6",
        accent: "#1F6FEB", pos: "#2EA043", neg: "#E5484D", warn: "#D29922",
      },
      fontFamily: { sans: ["Inter", "system-ui", "sans-serif"], mono: ["JetBrains Mono", "monospace"] },
    },
  },
  plugins: [],
} satisfies Config;
