import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, symbol = "so'm"): string {
  // Format with space grouping e.g. 45 000 so'm
  const formattedNumber = Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${formattedNumber} ${symbol}`;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffInSeconds < 30) return 'Hozirgina';
  if (diffInSeconds < 60) return `${diffInSeconds} soniya oldin`;
  const diffInMinutes = Math.floor(diffInSeconds / 60);
  if (diffInMinutes < 60) return `${diffInMinutes} daqiqa oldin`;
  const diffInHours = Math.floor(diffInMinutes / 60);
  return `${diffInHours} soat oldin`;
}

export function getElapsedMinutes(dateString: string): number {
  const date = new Date(dateString);
  const now = new Date();
  return Math.floor((now.getTime() - date.getTime()) / (1000 * 60));
}
