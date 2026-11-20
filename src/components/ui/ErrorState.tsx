import { type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({
  title = 'Something went wrong',
  message,
  onRetry,
  className = '',
}: ErrorStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)]">
        <AlertTriangle className="h-7 w-7 text-danger" />
      </div>
      <p className="text-[17px] font-semibold tracking-tight text-ink">{title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-muted max-w-sm">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-4">
          Try again
        </Button>
      )}
    </div>
  );
}