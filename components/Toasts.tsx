'use client';

import { useStore } from '@/lib/store';
import { cls } from '@/lib/utils';

const ICONS: Record<string, string> = {
  success: 'bi-check-circle-fill',
  danger: 'bi-exclamation-circle-fill',
  warning: 'bi-exclamation-triangle-fill',
  info: 'bi-info-circle-fill',
};

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const dismiss = useStore((s) => s.dismissToast);

  if (!toasts.length) return null;

  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cls('toast-card', `toast-${t.variant}`)} role="status">
          <i className={`bi ${ICONS[t.variant]}`} aria-hidden="true" />
          <span className="toast-message">{t.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="Dismiss notification"
            onClick={() => dismiss(t.id)}
          >
            <i className="bi bi-x" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
