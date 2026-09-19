import type { Config } from "tailwindcss";

/** Accent scale: sage tints, then wheat/gold, then forest for actions. */
const AMBER = {
  50: "#F1F0E3",
  100: "#E6E6D1",
  200: "#D3D6B5",
  300: "#BCC39A",
  400: "#DDBD72",
  500: "#C5962A",
  600: "#263120",
  700: "#3F5637",
  800: "#33472C",
  900: "#1F2A1B",
  950: "#172016",
};

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    // The HARVEST.V2 design language: forest, wheat and cream. The stock
    // amber/orange/stone scales are remapped onto it so every existing
    // component (modals, forms, detail pages) follows without a rewrite.
    colors: ({ colors }) => ({
      // Deprecated v2 aliases are left out; reading them only prints warnings.
      ...Object.fromEntries(
        Object.entries(Object.getOwnPropertyDescriptors(colors))
          .filter(([name]) => !["lightBlue", "warmGray", "trueGray", "coolGray", "blueGray"].includes(name))
          .map(([name, d]) => [name, d.value ?? (colors as unknown as Record<string, unknown>)[name]]),
      ),
      white: "#FFFDF7",
      stone: {
        50: "#FBF8EF",
        100: "#F2EDDF",
        200: "#E7DEC8",
        300: "#D5CBB2",
        400: "#A89F87",
        500: "#847D68",
        600: "#625D4E",
        700: "#4D4A3F",
        800: "#33372B",
        900: "#263120",
        950: "#172016",
      },
      amber: AMBER,
      orange: AMBER,
    }),
    extend: {
      colors: {
        harvest: {
          earth: "#263120",
          field: "#3F5637",
          wheat: "#DDBD72",
          gold: "#C5962A",
          amber: "#C5962A",
          cream: "#F7F3E7",
          paper: "#FFFDF7",
          ink: "#171A13",
          text: "#4D4A3F",
          muted: "#847D68",
          border: "#E7DEC8",
          success: "#28744E",
          danger: "#C53030",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Georgia", "Times New Roman", "serif"],
        body: ["var(--font-dm-sans)", "sans-serif"],
      },
      boxShadow: {
        harvest: "0 24px 80px rgba(38,49,32,0.16)",
      },
      maxWidth: {
        prose: "38rem",
      },
      animation: {
        "fade-in": "fadeIn 0.6s ease-out forwards",
        "slide-up": "slideUp 0.6s ease-out forwards",
        "progress": "progress 1.5s ease-out forwards",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        progress: {
          "0%": { width: "0%" },
          "100%": { width: "var(--progress-width)" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
