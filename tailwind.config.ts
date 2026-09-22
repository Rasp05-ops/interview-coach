import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f3f5f2",
        surface: "#ffffff",
        card: "#ffffff",
        border: "#d8e1da",
        ink: "#17231f",
        muted: "#65736b",
        dim: "#8d9b91",
        accent: "#e05b3f",
        "accent-dim": "#fff0eb",
        success: "#2d8a61",
        "success-dim": "#e5f3eb",
        warning: "#b57920",
        "warning-dim": "#fff2d7",
        danger: "#c94d45",
        "danger-dim": "#fde9e7",
        forest: "#214c3a",
        "forest-dim": "#e5f0e9",
      },
      keyframes: {
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: { from: { opacity: "0", transform: "translateY(10px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        blink: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0" } },
      },
      animation: {
        "fade-in": "fadeIn 0.25s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
        blink: "blink 1s step-end infinite",
      },
    },
  },
  plugins: [],
};
export default config;
