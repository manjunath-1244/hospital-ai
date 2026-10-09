'use client';

/**
 * The design system's building blocks. Screens compose these; they do not hand-roll buttons, cards, headings, tables,
 * badges or alerts. One place decides spacing, colour, focus and accessibility.
 */
import React, { useId } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' ');

/* ---------- Tones (status colours: the ONLY colour language besides brand navy) ---------- */
export type Tone = 'neutral' | 'brand' | 'info' | 'success' | 'warning' | 'danger';

export const TONE_BADGE: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-2 border-line-strong',
  brand: 'bg-brand-50 text-brand-700 border-brand-200',
  info: 'bg-info-50 text-info-700 border-info-200',
  success: 'bg-success-50 text-success-700 border-success-200',
  warning: 'bg-warning-50 text-warning-700 border-warning-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
};

export const TONE_ALERT: Record<Tone, string> = {
  neutral: 'bg-surface-muted text-ink-2 border-line-strong',
  brand: 'bg-brand-50 text-brand-800 border-brand-200',
  info: 'bg-info-50 text-info-700 border-info-200',
  success: 'bg-success-50 text-success-700 border-success-200',
  warning: 'bg-warning-50 text-warning-700 border-warning-200',
  danger: 'bg-danger-50 text-danger-700 border-danger-200',
};

/* ---------- Button ---------- */
type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
type ButtonSize = 'md' | 'sm';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white border-brand-700 hover:bg-brand-800 disabled:bg-brand-300 disabled:border-brand-300',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-surface-muted disabled:text-ink-3 disabled:bg-surface-muted',
  ghost: 'bg-transparent text-brand-700 border-transparent hover:bg-brand-50 disabled:text-ink-3',
  danger: 'bg-danger-600 text-white border-danger-600 hover:bg-danger-700 disabled:opacity-50',
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg border font-semibold whitespace-nowrap',
        size === 'md' ? 'min-h-11 px-4 text-sm' : 'min-h-9 px-3 text-sm',
        BUTTON_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

/* ---------- Card ---------- */
export const Card: React.FC<React.HTMLAttributes<HTMLElement> & { as?: 'section' | 'div' | 'article'; padded?: boolean }> = ({
  as: Tag = 'section',
  padded = true,
  className,
  children,
  ...rest
}) => (
  <Tag className={cx('rounded-card border border-line bg-surface shadow-card', padded && 'p-5', className)} {...rest}>
    {children}
  </Tag>
);

/** Heading of a card or section: the single heading style used inside screens (h2). */
export const SectionTitle: React.FC<{ children: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; as?: 'h2' | 'h3'; hint?: string; className?: string }> = ({
  children,
  icon,
  actions,
  as: Tag = 'h2',
  hint,
  className,
}) => (
  <div className={cx('mb-4 flex flex-wrap items-start justify-between gap-3', className)}>
    <div className="min-w-0">
      <Tag className="flex items-center gap-2 text-lg font-semibold text-ink">
        {icon ? <span className="text-brand-600" aria-hidden>{icon}</span> : null}
        {children}
      </Tag>
      {hint ? <p className="mt-0.5 text-sm text-ink-3">{hint}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

/** Top of a portal/screen (h1). */
export const PageHeader: React.FC<{ title: string; subtitle?: string; actions?: React.ReactNode; icon?: React.ReactNode }> = ({ title, subtitle, actions, icon }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
    <div className="min-w-0">
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-ink">
        {icon ? <span className="text-brand-600" aria-hidden>{icon}</span> : null}
        {title}
      </h1>
      {subtitle ? <p className="mt-1 text-sm text-ink-3">{subtitle}</p> : null}
    </div>
    {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
  </div>
);

/* ---------- Stat tile ---------- */
export const StatTile: React.FC<{ label: string; value: React.ReactNode; hint?: string; tone?: Tone; icon?: React.ReactNode }> = ({ label, value, hint, tone = 'neutral', icon }) => (
  <div className="rounded-card border border-line bg-surface p-4 shadow-card">
    <div className="flex items-center justify-between gap-2">
      <p className="text-sm font-medium text-ink-3">{label}</p>
      {icon ? <span className="text-ink-3" aria-hidden>{icon}</span> : null}
    </div>
    <p
      className={cx(
        'mt-1 text-3xl font-semibold tabular-nums',
        tone === 'danger' ? 'text-danger-700' : tone === 'warning' ? 'text-warning-700' : tone === 'success' ? 'text-success-700' : 'text-ink',
      )}
    >
      {value}
    </p>
    {hint ? <p className="mt-0.5 text-xs text-ink-3">{hint}</p> : null}
  </div>
);

/* ---------- Badge ---------- */
export const Badge: React.FC<{ tone?: Tone; children: React.ReactNode; title?: string; className?: string }> = ({ tone = 'neutral', children, title, className }) => (
  <span title={title} className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold', TONE_BADGE[tone], className)}>
    {children}
  </span>
);

/* ---------- Alert ---------- */
const ALERT_ICON: Record<Tone, React.ReactNode> = {
  neutral: <Info className="h-4 w-4" />,
  brand: <Info className="h-4 w-4" />,
  info: <Info className="h-4 w-4" />,
  success: <CheckCircle2 className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  danger: <AlertCircle className="h-4 w-4" />,
};

export const Alert: React.FC<{ tone?: Tone; title?: string; children?: React.ReactNode; testId?: string; live?: 'polite' | 'assertive' }> = ({ tone = 'info', title, children, testId, live }) => (
  <div
    role={tone === 'danger' ? 'alert' : 'status'}
    aria-live={live}
    data-testid={testId}
    className={cx('flex items-start gap-2.5 rounded-lg border p-3.5 text-sm', TONE_ALERT[tone])}
  >
    <span className="mt-0.5 shrink-0" aria-hidden>{ALERT_ICON[tone]}</span>
    <div className="min-w-0 break-words">
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? 'mt-0.5' : ''}>{children}</div> : null}
    </div>
  </div>
);

/* ---------- Form fields ---------- */
export const fieldInputCls =
  'w-full min-h-11 rounded-lg border border-line-strong bg-surface px-3.5 py-2 text-sm text-ink placeholder:text-ink-3 focus:border-brand-500 disabled:bg-surface-muted disabled:text-ink-3';

/** Label directly followed by its control (keeps label->control adjacency that tests and screen readers rely on). */
export const Field: React.FC<{ label: string; hint?: string; error?: string; children: (id: string) => React.ReactNode; className?: string }> = ({ label, hint, error, children, className }) => {
  const id = useId();
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      {children(id)}
      {hint && !error ? <p className="mt-1 text-xs text-ink-3">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-danger-700">{error}</p> : null}
    </div>
  );
};

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldInputCls, className)} {...rest} />;
});
export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(fieldInputCls, className)} {...rest}>
      {children}
    </select>
  );
});
export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldInputCls, 'min-h-24 py-2.5', className)} {...rest} />;
});

/* ---------- Table (wraps the global table styles in a bordered, scrollable frame) ---------- */
export const TableFrame: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
  <div className={cx('overflow-x-auto rounded-lg border border-line bg-surface', className)}>{children}</div>
);

/* ---------- Tabs (accessible: roving tabindex, arrow keys) ---------- */
export const Tabs: React.FC<{ tabs: Array<{ id: string; label: string; count?: number }>; value: string; onChange: (id: string) => void; label: string }> = ({ tabs, value, onChange, label }) => {
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = (i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length;
    onChange(tabs[next].id);
    (e.currentTarget.parentElement?.children[next] as HTMLElement | undefined)?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 border-b border-line">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={cx(
            '-mb-px min-h-11 border-b-2 px-4 text-sm font-semibold',
            value === t.id ? 'border-brand-700 text-brand-700' : 'border-transparent text-ink-3 hover:text-ink',
          )}
        >
          {t.label}
          {t.count != null ? <span className="ml-1.5 rounded-full bg-surface-muted px-1.5 py-0.5 text-xs text-ink-2">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
};

/* ---------- Empty / loading ---------- */
export const EmptyState: React.FC<{ title: string; hint?: string; icon?: React.ReactNode; action?: React.ReactNode }> = ({ title, hint, icon, action }) => (
  <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line-strong bg-surface-muted px-4 py-10 text-center">
    {icon ? <span className="text-ink-3" aria-hidden>{icon}</span> : null}
    <p className="text-sm font-semibold text-ink-2">{title}</p>
    {hint ? <p className="max-w-md text-sm text-ink-3">{hint}</p> : null}
    {action ? <div className="mt-2">{action}</div> : null}
  </div>
);

export const Spinner: React.FC<{ text?: string }> = ({ text = 'Loading...' }) => (
  <div className="flex items-center gap-2.5 py-6 text-sm text-ink-3" role="status" aria-live="polite">
    <Loader2 className="h-4 w-4 animate-spin text-brand-600" aria-hidden /> {text}
  </div>
);

export const Skeleton: React.FC<{ className?: string }> = ({ className }) => <div aria-hidden className={cx('animate-pulse rounded-md bg-line', className)} />;

/** Key/value line used in detail panes. */
export const Detail: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <div className="flex flex-wrap gap-x-2 text-sm">
    <dt className="text-ink-3">{label}:</dt>
    <dd className="min-w-0 break-words font-medium text-ink">{children}</dd>
  </div>
);

export { cx };
