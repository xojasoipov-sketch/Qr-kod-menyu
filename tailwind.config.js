/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0C0A09", // Deep obsidian
        surface: {
          50: "#1C1917",
          100: "#161311",
          200: "#221D1A",
          300: "#2D2622",
          400: "#3D342E",
          border: "#332B25",
        },
        gold: {
          50: "#FDF8ED",
          100: "#FBF0D5",
          200: "#F6DF9F",
          300: "#EFCB68",
          400: "#E5A93C",
          500: "#D4942A",
          600: "#B8761D",
          700: "#915616",
          800: "#754417",
          900: "#603716",
          accent: "#D4AF37",
        },
        brand: {
          primary: "#E5A93C",
          secondary: "#D4AF37",
          dark: "#0C0A09",
          card: "#161311",
        }
      },
      fontFamily: {
        serif: ['var(--font-playfair)', 'Georgia', 'serif'],
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'gold-glow': '0 0 25px -5px rgba(229, 169, 60, 0.25)',
        'gold-glow-lg': '0 0 35px -5px rgba(229, 169, 60, 0.4)',
        'luxury': '0 10px 30px -10px rgba(0, 0, 0, 0.7), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
      },
      animation: {
        'pulse-subtle': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.25s ease-out forwards',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      }
    },
  },
  plugins: [],
};
