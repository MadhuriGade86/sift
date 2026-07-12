import { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-card border border-ink-300 bg-surface p-6 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/** Loading state — skeleton matching final layout shape, not a spinner. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-ink-300/40 ${className}`} />;
}

/** Empty state — always paired with a primary CTA so the user never hits a dead end. */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-ink-300 py-16 text-center">
      <p className="text-lg font-medium text-ink-900">{title}</p>
      <p className="max-w-sm text-sm text-ink-600">{description}</p>
      {action}
    </div>
  );
}

/** Error state — names the fix, has a retry, never says "something went wrong" alone. */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-card border border-danger/30 bg-danger/5 py-16 text-center">
      <p className="text-sm font-medium text-danger">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="rounded bg-white border border-ink-300 px-4 py-2 text-sm font-medium hover:bg-ink-100 min-h-[44px]"
        >
          Try again
        </button>
      )}
    </div>
  );
}
