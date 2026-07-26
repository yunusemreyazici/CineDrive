import React from 'react';

interface SettingsCardProps {
  /** Anchor target used by the settings search. */
  id: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
  /** Rendered on the right of the header — a status pill or a primary action. */
  action?: React.ReactNode;
  tone?: 'default' | 'danger';
  children: React.ReactNode;
}

/**
 * Every settings section shares this shell. It replaces the attribute-selector
 * overrides that used to live in index.css (`.settings-general > * [class~='pb-4']`
 * and friends), which silently broke whenever a utility class was renamed.
 */
export const SettingsCard: React.FC<SettingsCardProps> = ({
  id,
  title,
  description,
  icon,
  action,
  tone = 'default',
  children,
}) => (
  <section
    id={id}
    // content-visibility keeps the long settings tab cheap to paint; the
    // intrinsic size stops the scrollbar from jumping as sections realise.
    style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}
    className={`scroll-mt-24 space-y-4 rounded-2xl border p-4 ${
      tone === 'danger'
        ? 'border-rose-500/20 bg-rose-500/5'
        : 'border-zinc-800/60 bg-zinc-900/40'
    }`}
  >
    <header
      className={`flex flex-wrap items-center justify-between gap-3 border-b pb-3 ${
        tone === 'danger' ? 'border-rose-500/20' : 'border-zinc-800'
      }`}
    >
      <div className="flex items-center gap-3">
        {icon}
        <div>
          <h3 className="font-display text-base font-bold text-white">{title}</h3>
          {description && <p className="text-xs text-zinc-400">{description}</p>}
        </div>
      </div>
      {action}
    </header>
    {children}
  </section>
);

/** Shared input styling so each section does not repeat the same 6 utilities. */
export const SETTINGS_INPUT_CLASSES =
  'w-full rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-2.5 text-xs text-zinc-100 placeholder-zinc-600 transition-colors focus:border-brand-500 focus:outline-none';

export const SETTINGS_LABEL_CLASSES = 'block text-xs font-semibold text-zinc-200';

interface SettingsFieldProps {
  id: string;
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

/** Pairs a label with its control so the association is impossible to forget. */
export const SettingsField: React.FC<SettingsFieldProps> = ({
  id,
  label,
  hint,
  children,
  className = '',
}) => (
  <div className={`space-y-1.5 ${className}`}>
    <label htmlFor={id} className={SETTINGS_LABEL_CLASSES}>
      {label}
    </label>
    {children}
    {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
  </div>
);
