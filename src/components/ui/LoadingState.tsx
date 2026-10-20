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
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="mt-3 text-sm font-medium">{message}</p>
    </div>
  );
}