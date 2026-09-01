import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypescript from 'eslint-config-next/typescript'

// `eslint-config-next` ships already-flat config arrays (built directly from
// each plugin's own `configs['core-web-vitals']` object) as of the Next 16
// release this project pins. Loading them through `FlatCompat.extends(...)`
// — the legacy-shareable-config shim — routes them back through
// `@eslint/eslintrc`'s validator, which calls `JSON.stringify` on the merged
// config for its error messages and throws `TypeError: Converting circular
// structure to JSON` the moment a plugin's flat config self-references
// (`eslint-plugin-react`'s `configs.flat.recommended.plugins.react ===
// eslint-plugin-react`, a normal pattern for flat-config plugins). Importing
// the arrays directly avoids that shim entirely — this is not a workaround,
// it is what the package's own subpath exports are for.
const config = [
  {
    ignores: ['.next/**', 'node_modules/**', 'out/**', 'next-env.d.ts', 'supabase/**'],
  },
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['warn', { allow: ['warn', 'error'] }],

      // eslint-plugin-react-hooks ships its React Compiler readiness rules
      // as errors by default. This project does not enable the React
      // Compiler (no babel-plugin-react-compiler, no `reactCompiler` in
      // next.config.ts) — these three rules are advisories about a future
      // opt-in, not runtime bugs; nothing here changes behaviour today.
      // `set-state-in-effect` in particular false-positives on the standard,
      // hydration-safe "read a browser-only API and sync it into state on
      // mount" pattern (localStorage, matchMedia, document attributes) used
      // throughout src/components/ui — there is no way to compute those
      // values during SSR, so an effect is the correct tool, not a smell.
      // `refs` similarly flags refs read inside event-handler closures built
      // by a plain render-time factory function (e.g. quantity-stepper's
      // pressHandlers), which never touches the ref during the render pass
      // itself. Kept as `warn` — visible, not blocking — rather than
      // silenced, so a real regression introduced later still surfaces.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/refs': 'warn',
    },
  },
]

export default config
