import { ButtonHTMLAttributes, forwardRef } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "danger" | "ghost";
  loading?: boolean;
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "bg-accent text-white hover:bg-accent-hover disabled:bg-ink-300",
  secondary: "bg-white text-ink-900 border border-ink-300 hover:bg-ink-100 disabled:text-ink-300",
  danger: "bg-danger text-white hover:bg-red-700 disabled:bg-ink-300",
  ghost: "bg-transparent text-ink-600 hover:bg-ink-100 disabled:text-ink-300",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", loading, disabled, className = "", children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        disabled={disabled || loading}
        className={`inline-flex items-center justify-center gap-2 rounded px-4 py-2 text-sm font-medium
          transition-colors duration-micro
          disabled:cursor-not-allowed
          min-h-[44px]
          ${VARIANT_CLASSES[variant]} ${className}`}
        {...props}
      >
        {loading && (
          <span
            className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
            aria-hidden="true"
          />
        )}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
