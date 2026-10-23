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
    'bg-primary text-white border-transparent hover:bg-primary-dark focus-visible:ring-primary/35 active:bg-primary-dark',
  secondary:
    'bg-white text-ink border-transparent shadow-[0_0_0_0.5px_rgba(60,60,67,0.16)] hover:bg-[#f2f2f7] focus-visible:ring-primary/35',
  outline:
    'bg-transparent text-primary border-transparent hover:bg-primary/10 focus-visible:ring-primary/35',
  ghost:
    'bg-transparent text-muted hover:bg-black/[0.04] focus-visible:ring-primary/35',
  danger:
    'bg-danger text-white border-transparent hover:bg-red-600 focus-visible:ring-danger/35',
  success:
    'bg-success text-white border-transparent hover:bg-emerald-600 focus-visible:ring-success/35',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1 text-[13px] rounded-full',
  md: 'min-h-11 px-4 py-2 text-[15px] rounded-[12px]',
  lg: 'min-h-12 px-5 py-3 text-[17px] rounded-[14px]',
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
          'inline-flex items-center justify-center gap-2 border font-semibold tracking-tight transition-[transform,background-color,color] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100',
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