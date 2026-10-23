import { type ReactNode } from 'react';
import { cn } from '@/utils/cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center py-14 px-6',
        className
      )}
    >
      {icon && (
        <div className="mb-3 flex h-16 w-16 items-center justify-center rounded-full bg-white text-muted shadow-[0_0_0_0.5px_rgba(60,60,67,0.12)] [&>svg]:h-7 [&>svg]:w-7">
          {icon}
        </div>
      )}
      <p className="text-[17px] font-semibold tracking-tight text-ink">{title}</p>
      {description && (
        <p className="mt-1 text-[13px] leading-relaxed text-muted max-w-sm">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}