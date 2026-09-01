/**
 * src/lib/utils/cn.ts — the one class-composition helper.
 * Source: docs/architecture/04-design-system.md §6.0.
 *
 * `clsx` resolves conditionals and arrays; `tailwind-merge` then resolves conflicts
 * so the LAST class wins within a Tailwind group. That ordering is what lets every
 * component accept a `className` prop, merge it last, and guarantee a caller can
 * always override — without any component hand-concatenating strings.
 *
 *   cn('px-4 py-2', isActive && 'bg-accent-soft', className)
 *
 * There is no `class-variance-authority` in this project (contract C-14). A variant
 * is a plain frozen record the component indexes into; see §6.0.
 */

import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export const cn = (...inputs: ClassValue[]): string => twMerge(clsx(inputs))
