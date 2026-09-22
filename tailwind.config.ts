import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0a0b0d",
        surface: "#131519",
        card: "#16181d",
        elevated: "#1c1f25",
        border: "#25282f",
        "border-soft": "#1c1f25",
        ink: "#eeece5",
        muted: "#9a9ca3",
        dim: "#63656d",
        accent: "#c9a24b",
        "accent-dim": "#211c10",
        "accent-soft": "#d9bb75",
        success: "#7fae83",
        "success-dim": "#151d16",
        warning: "#c2823f",
        "warning-dim": "#201709",
        danger: "#bd6459",
        "danger-dim": "#20100e",
        forest: "#0e1013",
        "forest-dim": "#171a1e",
      },
      fontFamily: {
        display: ["var(--font-fraunces)", "Georgia", "serif"],
        sans: ["var(--font-inter)", "Segoe UI", "sans-serif"],
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        blink: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
        riseIn: { from: { opacity: "0", transform: "translateY(14px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fadeIn 0.3s ease-out",
        "slide-up": "slideUp 0.35s cubic-bezier(.16,1,.3,1)",
        blink: "blink 1s step-end infinite",
        "rise-in": "riseIn 0.6s cubic-bezier(.16,1,.3,1) both",
      },
    },
  },
  plugins: [],
};
export default config;