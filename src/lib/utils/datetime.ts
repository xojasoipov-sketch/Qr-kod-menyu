/**
 * Timezone arithmetic.
 *
 * Locale-aware *presentation* of dates lives in src/lib/i18n/format.ts. This
 * module answers the question the analytics need: which business day does this
 * instant belong to, in the branch's own timezone?
 *
 * That distinction matters because a restaurant group can span timezones, and
 * "today's revenue" for a branch in Tashkent must not be computed against the
 * server's UTC midnight. Getting this wrong silently misreports the headline
 * number of the product, and it misreports it most on the late shift.
 */

/**
 * The calendar date, in `timezone`, on which `at` falls — as `YYYY-MM-DD`.
 *
 * Uses Intl rather than manual offset arithmetic so that daylight saving and
 * historical offset changes are handled by the platform's tz database instead
 * of by us.
 */
export function businessDateFor(timezone: string, at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(at)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''

  return `${get('year')}-${get('month')}-${get('day')}`
}

/** True when two instants fall on the same business day in the given timezone. */
export function isSameBusinessDate(timezone: string, a: Date, b: Date): boolean {
  return businessDateFor(timezone, a) === businessDateFor(timezone, b)
}

/**
 * The UTC instant at which a business date begins in `timezone`.
 *
 * Found by probing rather than by adding a fixed offset: the offset itself
 * depends on the date, so computing it from the target date is circular. Two
 * passes converge because a zone's offset never shifts by more than a day.
 */
export function startOfBusinessDayUtc(timezone: string, businessDate: string): Date {
  const [year, month, day] = businessDate.split('-').map(Number)
  if (!year || !month || !day) {
    throw new RangeError(`Not a YYYY-MM-DD business date: ${businessDate}`)
  }

  let guess = Date.UTC(year, month - 1, day, 0, 0, 0)
  for (let pass = 0; pass < 2; pass += 1) {
    const offsetMs = zoneOffsetMs(timezone, new Date(guess))
    guess = Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMs
  }
  return new Date(guess)
}

/** The zone's UTC offset, in milliseconds, at a given instant. */
function zoneOffsetMs(timezone: string, at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(at)

  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value ?? '0')

  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  )
  return asUtc - Math.floor(at.getTime() / 1000) * 1000
}

/** True when `timezone` is a zone this runtime knows. Used to validate input. */
export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone })
    return true
  } catch {
    return false
  }
}
