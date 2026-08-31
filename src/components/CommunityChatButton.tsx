import { MessagesSquare } from 'lucide-react';
import { COMMUNITY_CHAT_URL } from '@/lib/community';
import { cn } from '@/utils/cn';
import { useT } from '@/lib/i18n';

type Variant = 'auth' | 'setup' | 'blocked' | 'care';

const VARIANT_CLASS: Record<Variant, string> = {
  auth:
    'w-full max-w-[280px] md:max-w-[300px] flex items-center justify-center gap-2 rounded-2xl bg-white/15 border border-white/20 px-4 py-3 text-white text-sm font-semibold touch-target',
  setup:
    'w-full py-3 text-primary text-sm font-semibold flex items-center justify-center gap-2 touch-target',
  blocked:
    'w-full inline-flex items-center justify-center gap-2 py-3.5 rounded-xl bg-white/15 border border-white/20 text-white font-semibold touch-target',
  care:
    'w-full flex items-center gap-3 p-3.5 rounded-xl border border-sky-200 bg-sky-50 text-sky-950 touch-target',
};

interface CommunityChatButtonProps {
  variant: Variant;
  className?: string;
  label?: string;
}

export default function CommunityChatButton({
  variant,
  className,
  label,
}: CommunityChatButtonProps) {
  const t = useT();
  const text = label || t('community.join');
  return (
    <a
      href={COMMUNITY_CHAT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={t('community.aria')}
      className={cn(VARIANT_CLASS[variant], className)}
    >
      <MessagesSquare className="w-4 h-4 flex-shrink-0" />
      {variant === 'care' ? (
        <div className="min-w-0 text-left">
          <p className="text-sm font-semibold">{text}</p>
          <p className="text-xs opacity-80 truncate">{t('community.telegram')}</p>
        </div>
      ) : (
        <span>{text}</span>
      )}
    </a>
  );
}
