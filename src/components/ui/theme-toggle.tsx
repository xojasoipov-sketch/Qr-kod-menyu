'use client';

/**
 * src/components/ui/theme-toggle.tsx — ThemeToggle.
 * Source: docs/architecture/04-design-system.md §3.5, §6.4, §9.2.
 *
 * The admin surface is the only one with two themes: customer is dark-committed
 * and the kitchen reads a device-scoped setting. This writes the preference and
 * re-runs exactly the resolution the pre-paint script ran, so the attribute the
 * CSS keys on (`<html data-theme>`) has one meaning and one writer per moment.
 *
 * It does NOT paint on first render — the inline script in <head> already did,
 * before first paint, which is the only way to avoid a light flash (§3.5). This
 * component is what happens afterwards.
 *
 * While the preference is 'system' it listens to `prefers-color-scheme` and
 * re-resolves, so a laptop switching to dark at sunset takes the admin with it.
 *
 * OWNERSHIP NOTE: `src/lib/theme/theme-script.ts` (§3.5) is the canonical home of
 * THEME_STORAGE_KEY and ThemePreference. That file is written with the root
 * layout (it needs the per-request CSP nonce). Until it lands these two
 * declarations live here; when it does, replace them with a re-export so the
 * storage key exists once. The literal MUST stay 'qros:theme'.
 */

import { useCallback, useEffect, useState } from 'react';
import { Monitor, Moon, Sun } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { IconButton } from './button';
import { SegmentedControl, type SegmentedOption } from './segmented-control';

/** Mirrors src/lib/theme/theme-script.ts §3.5 — keep the literal identical. */
export const THEME_STORAGE_KEY = 'qros:theme';
export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const PREFERENCES: readonly ThemePreference[] = ['light', 'dark', 'system'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Storage can throw outright (Safari private mode); a theme is never worth a crash. */
function readPreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
  } catch {
    return 'system';
  }
}

function writePreference(preference: ThemePreference): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* A session-only theme is a better outcome than a thrown error. */
  }
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference === 'light' || preference === 'dark') return preference;
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function applyTheme(preference: ThemePreference): void {
  document.documentElement.setAttribute('data-theme', resolveTheme(preference));
}

export interface ThemeToggleLabels {
  /** The control's own name, e.g. "Appearance". */
  group: string;
  light: string;
  dark: string;
  system: string;
}

export type ThemeToggleVariant = 'segmented' | 'icon';

export interface ThemeToggleProps {
  /**
   * REQUIRED and localised. The catalogue has no appearance keys yet, so — like
   * StatusPill's `label` — the words come from the caller rather than being
   * hard-coded in English here.
   */
  labels: ThemeToggleLabels;
  /** default 'segmented'; 'icon' cycles light → dark → system in a topbar. */
  variant?: ThemeToggleVariant;
  /** default 'md' */
  size?: 'sm' | 'md';
  className?: string;
}

const ICON_CLASS = 'size-4';

export function ThemeToggle({
  labels,
  variant = 'segmented',
  size = 'md',
  className,
}: ThemeToggleProps): React.JSX.Element {
  // 'system' on the server and on the first client render, so hydration matches;
  // the effect below corrects it from storage immediately afterwards.
  const [preference, setPreference] = useState<ThemePreference>('system');

  useEffect(() => {
    const stored = readPreference();
    setPreference(stored);
    applyTheme(stored);
  }, []);

  useEffect(() => {
    if (preference !== 'system') return;
    const media = window.matchMedia(DARK_QUERY);
    const onChange = (): void => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => {
      media.removeEventListener('change', onChange);
    };
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    setPreference(next);
    writePreference(next);
    applyTheme(next);
  }, []);

  if (variant === 'icon') {
    const index = PREFERENCES.indexOf(preference);
    const next = PREFERENCES[(index + 1) % PREFERENCES.length] ?? 'system';

    return (
      <IconButton
        label={`${labels.group}: ${labels[preference]}`}
        size={size === 'sm' ? 'sm' : 'md'}
        onClick={() => choose(next)}
        className={className}
        icon={<ThemeIcon preference={preference} />}
      />
    );
  }

  const options: readonly SegmentedOption<ThemePreference>[] = [
    { value: 'light', label: labels.light, icon: <Sun className={ICON_CLASS} strokeWidth={1.75} /> },
    { value: 'dark', label: labels.dark, icon: <Moon className={ICON_CLASS} strokeWidth={1.75} /> },
    {
      value: 'system',
      label: labels.system,
      icon: <Monitor className={ICON_CLASS} strokeWidth={1.75} />,
    },
  ];

  return (
    <SegmentedControl<ThemePreference>
      options={options}
      value={preference}
      onValueChange={choose}
      label={labels.group}
      size={size}
      className={cn(className)}
    />
  );
}

function ThemeIcon({ preference }: { preference: ThemePreference }): React.JSX.Element {
  if (preference === 'light') return <Sun className={ICON_CLASS} strokeWidth={1.75} />;
  if (preference === 'dark') return <Moon className={ICON_CLASS} strokeWidth={1.75} />;
  return <Monitor className={ICON_CLASS} strokeWidth={1.75} />;
}
