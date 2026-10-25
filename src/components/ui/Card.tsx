import { type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface CardProps {
  children: ReactNode;
  className?: string;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hover?: boolean;
}

const paddingClasses: Record<NonNullable<CardProps['padding']>, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export function Card({ children, className, padding = 'md', hover = false }: CardProps) {
  return (
    <div
      className={cn(
        'surface-card',
        paddingClasses[padding],
        hover && 'transition-transform hover:-translate-y-px',
        className
      )}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function CardHeader({ title, description, action, icon, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-3', className)}>
      <div className="flex items-center gap-2 min-w-0">
        {icon && <span className="flex-shrink-0 text-primary">{icon}</span>}
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold tracking-tight text-ink truncate">{title}</h3>
          {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
        </div>
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
}