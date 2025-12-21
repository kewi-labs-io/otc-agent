/**
 * Reusable loading spinner components
 * Used across all pages for consistent loading states
 */

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
 * Simple loading spinner
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
