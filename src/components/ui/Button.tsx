import { type ButtonHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/utils/cn';

export type ButtonVariant =
  | 'primary'
  | 'secondary'
  | 'outline'
  | 'ghost'
  | 'danger'
  | 'success';

export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  block?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-primary text-white border-transparent hover:bg-primary-dark focus-visible:ring-primary/40 active:bg-primary-dark',
  secondary:
    'bg-surface-card text-ink border-border hover:bg-surface-muted focus-visible:ring-primary/40',
  outline:
    'bg-transparent text-ink border-border hover:bg-surface-muted focus-visible:ring-primary/40',
  ghost:
    'bg-transparent text-muted hover:bg-surface-muted focus-visible:ring-primary/40',
  danger:
    'bg-danger text-white border-transparent hover:bg-red-700 focus-visible:ring-danger/40',
  success:
    'bg-success text-white border-transparent hover:bg-emerald-700 focus-visible:ring-success/40',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-4 py-2.5 text-sm',
  lg: 'px-5 py-3.5 text-base',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      loading = false,
      leftIcon,
      rightIcon,
      block = false,
      className,
      disabled,
      children,
      ...rest
    },
    ref
  ) => {
    const isDisabled = disabled || loading;
    return (
      <button
        ref={ref}
        type={rest.type ?? 'button'}
        disabled={isDisabled}
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-xl border font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50',
          variantClasses[variant],
          sizeClasses[size],
          block ? 'w-full' : '',
          className
        )}
        {...rest}
      >
        {loading ? (
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
        ) : (
          <>
            {leftIcon}
            {children}
            {rightIcon}
          </>
        )}
      </button>
    );
  }
);
;

/** Compact button used by the agent portal for row and toolbar actions. */
export function LinkButton({
  className,
  variant = 'outline',
  size = 'sm',
  icon,
  children,
  ...props
}: ButtonProps & { icon?: React.ReactNode }) {
  return (
    <Button
      variant={variant}
      size={size}
      leftIcon={icon}
      className={cn('w-auto', className)}
      {...props}
    >
      {children}
    </Button>
  );
}

Button.displayName = 'Button';