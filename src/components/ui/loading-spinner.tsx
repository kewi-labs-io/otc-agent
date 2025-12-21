/**
 * Reusable loading spinner components
 * Used across all pages for consistent loading states
 *
 * Two spinner variants:
 * - LoadingSpinner: CSS border-based, larger (default 48px), for page/card loading
 * - InlineSvgSpinner: SVG-based, smaller (default 16px), for inline/button loading
 */

import clsx from "clsx";

interface LoadingSpinnerProps {
  /** Size of the spinner in pixels */
  size?: number;
  /** Color class for the spinner border (e.g., 'border-blue-600', 'border-brand-500') */
  colorClass?: string;
  /** Optional message to display below the spinner */
  message?: string;
  /** Additional CSS classes */
  className?: string;
}

/**
 * CSS border-based loading spinner (larger, for page/card loading)
 */
export function LoadingSpinner({
  size = 48,
  colorClass = "border-brand-500",
  className = "",
}: LoadingSpinnerProps) {
  return (
    <div
      className={`animate-spin rounded-full border-b-2 ${colorClass} ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

/**
 * SVG-based inline loading spinner (smaller, for buttons/inline text)
 * Consolidated from components/spinner.tsx
 */
export function InlineSvgSpinner({
  className,
  size = 16,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <svg
      className={clsx(
        "animate-spin text-zinc-600 dark:text-zinc-400",
        className,
      )}
      style={{ width: size, height: size }}
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * Full page loading state with centered spinner and optional message
 */
export function PageLoading({
  message = "Loading...",
  colorClass = "border-brand-500",
}: LoadingSpinnerProps) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <LoadingSpinner
          size={48}
          colorClass={colorClass}
          className="mx-auto mb-4"
        />
        <div className="text-xl text-zinc-600 dark:text-zinc-400">
          {message}
        </div>
      </div>
    </div>
  );
}

/**
 * Inline loading state (not full page)
 */
export function InlineLoading({
  message = "Loading...",
  colorClass = "border-brand-500",
}: LoadingSpinnerProps) {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="text-center">
        <LoadingSpinner
          size={32}
          colorClass={colorClass}
          className="mx-auto mb-2"
        />
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          {message}
        </div>
      </div>
    </div>
  );
}

/**
 * Card/section loading state
 */
export function CardLoading({
  message,
  colorClass = "border-brand-500",
}: LoadingSpinnerProps) {
  return (
    <main className="flex-1 min-h-[60dvh] flex items-center justify-center">
      <div className="text-center">
        <LoadingSpinner
          size={48}
          colorClass={colorClass}
          className="mx-auto mb-4"
        />
        {message && (
          <div className="text-zinc-600 dark:text-zinc-400">{message}</div>
        )}
      </div>
    </main>
  );
}
