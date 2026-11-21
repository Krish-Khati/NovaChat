import type { Config } from "tailwindcss";

/**
 * NovaChat design tokens.
 * Accent = "Ember" (terracotta clay): a warm, editorial accent chosen
 * deliberately over the default blue/purple "AI gradient" cliché. It pairs
 * with warm paper/ink neutrals so the product feels crafted, not generated.
 * Dark mode is the default; light mode is a fully supported paper theme.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        card: "var(--card)",
        "card-foreground": "var(--card-foreground)",
        sidebar: "var(--sidebar)",
        "sidebar-foreground": "var(--sidebar-foreground)",
        muted: "var(--muted)",
        "muted-foreground": "var(--muted-foreground)",
        border: "var(--border)",
        accent: "var(--accent)",
        "accent-hover": "var(--accent-hover)",
        "accent-foreground": "var(--accent-foreground)",
        ring: "var(--ring)",
        success: "var(--success)",
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        soft: "0 8px 30px -12px rgb(0 0 0 / 0.35)",
        lift: "0 2px 10px -2px rgb(0 0 0 / 0.25)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        serif: ["Georgia", "Cambria", "Times New Roman", "serif"],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      keyframes: {
        "pulse-dot": {
          "0%, 100%": { opacity: "0.35", transform: "scale(0.8)" },
          "50%": { opacity: "1", transform: "scale(1)" },
        },
        eq: {
          "0%, 100%": { transform: "scaleY(0.25)" },
          "50%": { transform: "scaleY(1)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 1.2s ease-in-out infinite",
        eq: "eq 0.9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
export default config;
