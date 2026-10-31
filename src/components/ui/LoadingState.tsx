import { type ReactNode } from 'react';

interface LoadingStateProps {
  message?: string;
  className?: string;
  icon?: ReactNode;
}

export function LoadingState({
  message = 'Loading…',
  className = '',
  icon,
}: LoadingStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 text-muted ${className}`} role="status">
      <div className="mb-4 w-full max-w-sm space-y-2" aria-hidden="true">
        <div className="ux-skeleton h-4 w-2/3" />
        <div className="ux-skeleton h-4 w-full" />
        <div className="ux-skeleton h-4 w-4/5" />
      </div>
      {icon ?? (
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#E5E5EA] border-t-primary" />
      )}
      <p className="mt-3 text-[15px] font-medium tracking-tight">{message}</p>
    </div>
  );
}