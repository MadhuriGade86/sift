/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    // Handbook §07 UI/UX Expectations: 4px base spacing, 8px default rhythm.
    // Tailwind's default scale is already 4px-based (1 = 4px), so we keep it
    // rather than reinventing — it matches the spec exactly.
    extend: {
      colors: {
        // Handbook: "3 neutral grays, one accent, one radius, one font family."
        ink: {
          900: "#18181B", // primary text
          600: "#52525B", // secondary text
          300: "#D4D4D8", // borders / dividers
          100: "#F4F4F5", // subtle surface
        },
        accent: {
          DEFAULT: "#4F46E5", // single accent — indigo, used sparingly for primary actions
          hover: "#4338CA",
        },
        surface: "#FFFFFF",
        danger: "#DC2626",
        success: "#16A34A",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      fontSize: {
        // Handbook type scale: 12,14,16,20,24,32,48; body 16 / 1.5, headings 1.2
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["14px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.5" }],
        lg: ["20px", { lineHeight: "1.2" }],
        xl: ["24px", { lineHeight: "1.2" }],
        "2xl": ["32px", { lineHeight: "1.2" }],
        "3xl": ["48px", { lineHeight: "1.2" }],
      },
      borderRadius: {
        DEFAULT: "8px",
        input: "6px",
        card: "12px",
        pill: "9999px",
      },
      transitionDuration: {
        micro: "150ms",
        base: "200ms",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
    },
  },
  plugins: [],
};
