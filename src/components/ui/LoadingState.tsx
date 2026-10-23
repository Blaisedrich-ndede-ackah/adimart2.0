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
    <div className={`flex flex-col items-center justify-center py-16 text-muted ${className}`}>
      {icon ?? (
        <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-[#E5E5EA] border-t-primary" />
      )}
      <p className="mt-3 text-[15px] font-medium tracking-tight">{message}</p>
    </div>
  );
}