/**
 * src/components/ui/badge.tsx — Badge + StatusPill.
 * Source: docs/architecture/04-design-system.md §6.1, §8.10, C-8.
 *
 * Badge is a static label. StatusPill is the ONLY place in the codebase where a
 * database status becomes a colour (C-8), and it never lets colour be the only
 * channel: icon + localised word are always rendered (§8.10, WCAG 1.4.1).
 *
 * Both are Server Components — neither holds state and neither takes an event
 * handler, so they render inside a server tree without a client boundary.
 */

import type { ReactNode } from 'react';
import {
  AlarmClock,
  Ban,
  BellRing,
  Check,
  CheckCheck,
  CircleCheckBig,
  Clock,
  CookingPot,
  HandPlatter,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type { OrderStatus, WaiterCallStatus } from '@/types/database';
import { cn } from '@/lib/utils/cn';

/* ================================================================== */
/* Badge                                                               */
/* ================================================================== */

export type BadgeTone = 'neutral' | 'accent' | 'wine' | 'success' | 'warning' | 'danger' | 'info';
export type BadgeVariant = 'soft' | 'solid' | 'outline';
export type BadgeSize = 'sm' | 'md';

/**
 * `neutral` has no ramp of its own and borrows the ground tokens; `wine` has no
 * `-contrast` / `-line` slot in §3.2, so its solid fill pairs with `text-surface`
 * (ink-25 on wine-700 light, ink-950 on wine-300 dark — both clear 8:1) and its
 * outline uses the wine hue itself.
 */
const BADGE_TONE: Record<BadgeVariant, Record<BadgeTone, string>> = {
  soft: {
    neutral: 'bg-surface-sunken text-text-muted',
    accent: 'bg-accent-soft text-accent',
    wine: 'bg-wine-soft text-wine',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
    info: 'bg-info-soft text-info',
  },
  solid: {
    neutral: 'bg-elevated-2 text-text',
    accent: 'bg-accent-strong text-accent-contrast',
    wine: 'bg-wine text-surface',
    success: 'bg-success text-success-contrast',
    warning: 'bg-warning text-warning-contrast',
    danger: 'bg-danger text-danger-contrast',
    info: 'bg-info text-info-contrast',
  },
  outline: {
    neutral: 'border border-border text-text-muted',
    accent: 'border border-accent-line text-accent',
    wine: 'border border-wine text-wine',
    success: 'border border-success-line text-success',
    warning: 'border border-warning-line text-warning',
    danger: 'border border-danger-line text-danger',
    info: 'border border-info-line text-info',
  },
};

/** 18 / 22 px. Radius is --radius-xs: a badge is not a pill (§8.2) — that shape is StatusPill's. */
const BADGE_SIZE: Record<BadgeSize, string> = {
  sm: 'h-4.5 gap-1 px-1.5',
  md: 'h-5.5 gap-1.5 px-2',
};

export interface BadgeProps {
  /** default 'neutral' */
  tone?: BadgeTone;
  /** default 'soft' */
  variant?: BadgeVariant;
  /** default 'sm' */
  size?: BadgeSize;
  children: ReactNode;
  className?: string;
}

export function Badge({
  tone = 'neutral',
  variant = 'soft',
  size = 'sm',
  children,
  className,
}: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-xs text-overline uppercase',
        BADGE_SIZE[size],
        BADGE_TONE[variant][tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* ================================================================== */
/* StatusPill                                                          */
/* ================================================================== */

export type AvailabilityStatus = 'available' | 'unavailable';
export type StatusPillSize = 'sm' | 'md' | 'lg';

/** One row of the §6.1 status table: the tone, the fixed glyph (§5), and whether the dot breathes. */
interface StatusVisual {
  tone: BadgeTone;
  icon: LucideIcon;
  pulse: boolean;
}

/** C-8: order_status → colour is mapped here and nowhere else. */
const ORDER_STATUS: Record<OrderStatus, StatusVisual> = {
  pending: { tone: 'warning', icon: Clock, pulse: true },
  confirmed: { tone: 'info', icon: Check, pulse: false },
  preparing: { tone: 'info', icon: CookingPot, pulse: true },
  ready: { tone: 'success', icon: CheckCheck, pulse: false },
  delivered: { tone: 'success', icon: HandPlatter, pulse: false },
  completed: { tone: 'neutral', icon: CircleCheckBig, pulse: false },
  cancelled: { tone: 'danger', icon: XCircle, pulse: false },
};

const WAITER_CALL_STATUS: Record<WaiterCallStatus, StatusVisual> = {
  pending: { tone: 'danger', icon: BellRing, pulse: true },
  acknowledged: { tone: 'warning', icon: Check, pulse: false },
  resolved: { tone: 'success', icon: CheckCheck, pulse: false },
  cancelled: { tone: 'neutral', icon: XCircle, pulse: false },
  expired: { tone: 'neutral', icon: AlarmClock, pulse: false },
};

const AVAILABILITY_STATUS: Record<AvailabilityStatus, StatusVisual> = {
  available: { tone: 'success', icon: Check, pulse: false },
  unavailable: { tone: 'neutral', icon: Ban, pulse: false },
};

const PILL_SIZE: Record<StatusPillSize, string> = {
  sm: 'h-5.5 gap-1.5 px-2 text-overline uppercase',
  md: 'h-7 gap-1.5 px-2.5 text-caption',
  lg: 'h-11 gap-2.5 px-4 text-kds-label uppercase', // KDS only
};

const PILL_ICON_SIZE: Record<StatusPillSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-6',
};

/** Kitchen glyphs are read at two metres, so they carry the §5 kitchen stroke. */
const PILL_ICON_STROKE: Record<StatusPillSize, number> = { sm: 1.75, md: 1.75, lg: 2.25 };

const PILL_DOT_SIZE: Record<StatusPillSize, string> = {
  sm: 'size-1.5',
  md: 'size-1.5',
  lg: 'size-2.5',
};

interface StatusPillBaseProps {
  /** default 'sm'; 'lg' is KDS only. */
  size?: StatusPillSize;
  /**
   * The localised status word, e.g. `t('status.order.ready')`.
   * REQUIRED: colour is never the only channel (§8.10), and this component stays a
   * Server Component, so it cannot reach the client `useT()` itself.
   */
  label: string;
  /** default true */
  showDot?: boolean;
  className?: string;
}

export type StatusPillProps = StatusPillBaseProps &
  (
    | { kind: 'order'; status: OrderStatus }
    | { kind: 'waiter_call'; status: WaiterCallStatus }
    | { kind: 'availability'; status: AvailabilityStatus }
  );

function visualFor(props: StatusPillProps): StatusVisual {
  switch (props.kind) {
    case 'order':
      return ORDER_STATUS[props.status];
    case 'waiter_call':
      return WAITER_CALL_STATUS[props.status];
    case 'availability':
      return AVAILABILITY_STATUS[props.status];
  }
}

export function StatusPill(props: StatusPillProps): React.JSX.Element {
  const { size = 'sm', label, showDot = true, className } = props;
  const { tone, icon: Icon, pulse } = visualFor(props);

  return (
    <span
      data-status={props.status}
      className={cn(
        'inline-flex shrink-0 items-center rounded-full',
        PILL_SIZE[size],
        BADGE_TONE.soft[tone],
        className,
      )}
    >
      {showDot && (
        <span
          aria-hidden="true"
          className={cn(
            'shrink-0 rounded-full bg-current',
            PILL_DOT_SIZE[size],
            pulse && 'animate-pulse',
          )}
        />
      )}
      <Icon
        aria-hidden="true"
        focusable="false"
        strokeWidth={PILL_ICON_STROKE[size]}
        className={cn('u-icon-align', PILL_ICON_SIZE[size])}
      />
      <span>{label}</span>
    </span>
  );
}
