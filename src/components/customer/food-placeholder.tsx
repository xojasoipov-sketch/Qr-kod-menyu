/**
 * src/components/customer/food-placeholder.tsx — FoodPlaceholder.
 * Source: docs/architecture/04-design-system.md §10 ("the DishArtwork system").
 *
 * A deterministic generated plate for a dish, category or promotion with no
 * photograph: a warm gradient mesh derived from a hash of its name, a serif
 * monogram, a grain overlay and a gold hairline. The same name renders the same
 * plate on every device and every reload — a menu with no photography still
 * looks like a deliberate choice, never a broken image or a grey box (brief §5,
 * design system §10.1, §8.15).
 *
 * A pure function of its props — no network request, no client JS, safe inside a
 * Server Component. `useId()` keeps every instance's gradient/filter ids
 * document-unique so two plates on one page never bleed into each other.
 */

export type FoodPlaceholderRatio = '1:1' | '4:5' | '4:3' | '16:9'

export interface FoodPlaceholderProps {
  /** From `dishSeed()` — stable across viewer locale, changes if the dish is renamed. */
  seed: string
  /** The display name to derive the monogram glyph from (only its first grapheme is used). */
  monogram: string
  /** default '1:1' */
  ratio?: FoodPlaceholderRatio
  /** default true; pass false below ~64px, where a single letter reads as noise. */
  showMonogram?: boolean
  /** default true */
  grain?: boolean
  className?: string
}

/* ------------------------------------------------------------------ */
/* The seed                                                            */
/* ------------------------------------------------------------------ */

/** FNV-1a 32-bit. Stable across engines; no Math.random, no Date. */
function fnv1a32(input: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/**
 * The seed for one dish/category/promotion. `nameInDefaultLocale` MUST be the
 * name in the restaurant's `default_locale` — never the viewer's locale — so
 * every diner sees the same plate for the same dish regardless of which
 * language they are browsing in. `id` disambiguates two entries sharing a name.
 */
export function dishSeed(nameInDefaultLocale: string, id: string): string {
  return `${nameInDefaultLocale.trim().toLocaleLowerCase('en')}·${id.slice(0, 8)}`
}

/* ------------------------------------------------------------------ */
/* The plates — six hand-picked warm triples. Hue is not free: no dish ever    */
/* lands on lime green or SaaS indigo, and the whole menu reads as one place.  */
/* ------------------------------------------------------------------ */

interface Plate {
  readonly base: string
  readonly mid: string
  readonly hi: string
}

const PLATES: readonly Plate[] = [
  { base: '#270c10', mid: '#591f26', hi: '#a7593d' }, // wine
  { base: '#230c07', mid: '#581d12', hi: '#aa6926' }, // ember
  { base: '#211205', mid: '#503000', hi: '#a77f23' }, // saffron
  { base: '#151505', mid: '#2f3410', hi: '#837435' }, // herb
  { base: '#1c0e05', mid: '#432010', hi: '#8b5f18' }, // clove
  { base: '#140e09', mid: '#332619', hi: '#775f32' }, // char
]

/** Blob layouts in unit space: [cx, cy, r] × 3. */
const LAYOUTS: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [0.22, 0.28, 0.62],
    [0.78, 0.34, 0.55],
    [0.52, 0.86, 0.7],
  ],
  [
    [0.8, 0.22, 0.66],
    [0.18, 0.62, 0.58],
    [0.62, 0.92, 0.52],
  ],
  [
    [0.32, 0.8, 0.68],
    [0.72, 0.58, 0.6],
    [0.14, 0.16, 0.5],
  ],
  [
    [0.5, 0.18, 0.72],
    [0.12, 0.74, 0.56],
    [0.88, 0.76, 0.54],
  ],
]

const MONOGRAM_FILL = '#eed9a8' // gold-200
const HAIRLINE = '#d6a944' // gold-500

const RATIO_SIZE: Record<FoodPlaceholderRatio, { w: number; h: number }> = {
  '1:1': { w: 800, h: 800 },
  '4:5': { w: 800, h: 1000 },
  '4:3': { w: 800, h: 600 },
  '16:9': { w: 800, h: 450 },
}

/**
 * `Oʻ` → `O`, a Cyrillic `Плов` → `П`, an emoji-adjacent string never splits a
 * surrogate pair. Uppercasing is pinned to `'en'` so the plate is identical
 * across viewers regardless of the page's active locale.
 */
function firstGrapheme(value: string): string {
  const trimmed = value.trim()
  if (trimmed === '') return '?'
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' })
    const first = segmenter.segment(trimmed)[Symbol.iterator]().next()
    if (!first.done) return first.value.segment.toLocaleUpperCase('en')
  }
  return [...trimmed][0]!.toLocaleUpperCase('en')
}

export function FoodPlaceholder({
  seed,
  monogram,
  ratio = '1:1',
  showMonogram = true,
  grain = true,
  className,
}: FoodPlaceholderProps): React.JSX.Element {
  const h = fnv1a32(seed)
  const plate = PLATES[h % PLATES.length]!
  const layout = LAYOUTS[(h >>> 5) % LAYOUTS.length]!
  const rotation = ((h >>> 9) % 25) - 12
  const highlightBlob = (h >>> 14) % 3
  const monoX = 0.5 + (((h >>> 18) % 9) - 4) / 100
  const { w, h: height } = RATIO_SIZE[ratio]

  const uid = `fp-${h.toString(36)}`
  const glyph = firstGrapheme(monogram)

  return (
    <svg
      viewBox={`0 0 ${w} ${height}`}
      preserveAspectRatio="xMidYMid slice"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className ? `block h-full w-full ${className}` : 'block h-full w-full'}
    >
      <defs>
        {layout.map((blob, index) => {
          const [cx, cy, r] = blob
          const colour = index === highlightBlob ? plate.hi : plate.mid
          return (
            <radialGradient
              key={index}
              id={`${uid}-${index}`}
              cx={`${cx * 100}%`}
              cy={`${cy * 100}%`}
              r={`${r * 100}%`}
            >
              <stop offset="0%" stopColor={colour} stopOpacity="0.95" />
              <stop offset="100%" stopColor={colour} stopOpacity="0" />
            </radialGradient>
          )
        })}
        {grain && (
          <filter id={`${uid}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.86"
              numOctaves={3}
              stitchTiles="stitch"
              result="n"
            />
            <feColorMatrix in="n" type="saturate" values="0" result="g" />
            <feComponentTransfer in="g">
              <feFuncA type="linear" slope="0.5" />
            </feComponentTransfer>
          </filter>
        )}
      </defs>

      <rect width={w} height={height} fill={plate.base} />
      <g transform={`rotate(${rotation} ${w / 2} ${height / 2})`}>
        {layout.map((_blob, index) => (
          <rect key={index} width={w} height={height} fill={`url(#${uid}-${index})`} />
        ))}
      </g>

      {showMonogram && (
        <text
          x={monoX * w}
          y={height / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-display)"
          fontWeight={500}
          fontSize={height * 0.38}
          letterSpacing="0.02em"
          fill={MONOGRAM_FILL}
          fillOpacity="0.13"
        >
          {glyph}
        </text>
      )}

      {grain && (
        <rect
          width={w}
          height={height}
          filter={`url(#${uid}-grain)`}
          opacity="0.055"
          style={{ mixBlendMode: 'overlay' }}
        />
      )}
      <rect
        x={0.5}
        y={0.5}
        width={w - 1}
        height={height - 1}
        fill="none"
        stroke={HAIRLINE}
        strokeOpacity="0.1"
        strokeWidth={1}
      />
    </svg>
  )
}
