import React from 'react';
import { Check, Loader2 } from 'lucide-react';

/**
 * The shared vocabulary every settings section is built from.
 *
 * The sections used to style themselves: eight different accent colours for the
 * header icons, five button treatments, `text-xs` for body copy next to
 * `text-sm` for the same kind of copy elsewhere, and boxes nested three deep.
 * Everything here exists so a section describes *what* it shows and never *how*
 * it looks — colour is now reserved for meaning (green connected, amber needs
 * attention, red destructive) instead of decoration.
 */

type IconComponent = React.ComponentType<{ className?: string }>;

interface SettingsCardProps {
  /** Anchor target used by the settings search. */
  id: string;
  title: string;
  description?: string;
  icon: IconComponent;
  /** Rendered on the right of the header — a status pill or a primary action. */
  action?: React.ReactNode;
  tone?: 'default' | 'danger';
  /**
   * Forms stay inside a readable measure; tables and account lists earn the
   * full panel. Defaults to the form width because most sections are forms.
   */
  width?: 'form' | 'full';
  children: React.ReactNode;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
  id,
  title,
  description,
  icon: Icon,
  action,
  tone = 'default',
  width = 'form',
  children,
}) => (
  <section
    id={id}
    // content-visibility keeps the long settings tab cheap to paint; the
    // intrinsic size stops the scrollbar from jumping as sections realise.
    style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 280px' }}
    className="scroll-mt-24 border-t border-zinc-800/60 py-8 first:border-t-0 first:pt-1"
  >
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon
          className={`mt-px h-4 w-4 shrink-0 ${
            tone === 'danger' ? 'text-rose-400/90' : 'text-zinc-500'
          }`}
        />
        <div className="min-w-0">
          <h3 className="font-display text-[15px] font-semibold leading-tight text-white">
            {title}
          </h3>
          {description && (
            <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-zinc-500">
              {description}
            </p>
          )}
        </div>
      </div>
      {action}
    </header>

    <div className={`mt-5 ${width === 'form' ? 'max-w-xl' : ''}`}>{children}</div>
  </section>
);

export const SETTINGS_INPUT_CLASSES =
  'w-full rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 transition-colors focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/40';

export const SETTINGS_LABEL_CLASSES = 'block text-[13px] font-medium text-zinc-300';

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
    {hint && <p className="text-xs leading-relaxed text-zinc-500">{hint}</p>}
  </div>
);

const BUTTON_VARIANT_CLASSES = {
  primary: 'bg-brand-600 text-white hover:bg-brand-500',
  secondary: 'border border-zinc-700 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-800/60',
  danger: 'border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20',
} as const;

interface SettingsButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof BUTTON_VARIANT_CLASSES;
  icon?: IconComponent;
  isLoading?: boolean;
  /** Replaces the label while `isLoading`; falls back to the label itself. */
  loadingLabel?: string;
  children: React.ReactNode;
}

/**
 * One button, three meanings. The glow shadows the sections each applied by
 * hand made every action look equally urgent.
 */
export const SettingsButton: React.FC<SettingsButtonProps> = ({
  variant = 'primary',
  icon: Icon,
  isLoading = false,
  loadingLabel,
  disabled,
  className = '',
  children,
  ...buttonProps
}) => (
  <button
    {...buttonProps}
    disabled={disabled || isLoading}
    className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-[13px] font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_VARIANT_CLASSES[variant]} ${className}`}
  >
    {isLoading ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : (
      Icon && <Icon className="h-4 w-4" />
    )}
    <span>{isLoading ? loadingLabel || children : children}</span>
  </button>
);

interface SettingsRowProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
}

/** A setting whose control sits opposite its explanation. */
export const SettingsRow: React.FC<SettingsRowProps> = ({ title, description, children }) => (
  <div className="flex items-start justify-between gap-6 border-t border-zinc-800/50 py-4 first:border-t-0 first:pt-0">
    <div className="min-w-0">
      <p className="text-[13px] font-medium text-zinc-200">{title}</p>
      {description && (
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</p>
      )}
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

interface SettingsToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
}

export const SettingsToggle: React.FC<SettingsToggleProps> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative h-6 w-11 shrink-0 rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${
      checked ? 'bg-brand-600' : 'bg-zinc-700'
    }`}
  >
    <span
      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
        checked ? 'translate-x-[22px]' : 'translate-x-0.5'
      }`}
    />
  </button>
);

const STATUS_TONE_CLASSES = {
  ok: 'text-emerald-400',
  warning: 'text-amber-400',
  neutral: 'text-zinc-400',
} as const;

interface SettingsStatusProps {
  tone: keyof typeof STATUS_TONE_CLASSES;
  icon?: IconComponent;
  children: React.ReactNode;
}

/** Header status. A dot and a word carry this as well as a filled pill did. */
export const SettingsStatus: React.FC<SettingsStatusProps> = ({ tone, icon: Icon, children }) => (
  <span
    className={`inline-flex items-center gap-1.5 text-xs font-medium ${STATUS_TONE_CLASSES[tone]}`}
  >
    {Icon ? (
      <Icon className="h-3.5 w-3.5" />
    ) : (
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
    )}
    {children}
  </span>
);

interface SettingsChoiceProps {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description?: string;
  /** A colour swatch for theme choices; omitted elsewhere. */
  swatchClass?: string;
}

/** The radio-as-card pattern, shared by the theme picker and the scan scope. */
export const SettingsChoice: React.FC<SettingsChoiceProps> = ({
  selected,
  onSelect,
  title,
  description,
  swatchClass,
}) => (
  <button
    type="button"
    role="radio"
    aria-checked={selected}
    onClick={onSelect}
    className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${
      selected
        ? 'border-brand-500/70 bg-brand-500/[0.07]'
        : 'border-zinc-800 hover:border-zinc-700 hover:bg-zinc-900/40'
    }`}
  >
    <span className="flex items-center gap-2">
      {swatchClass && <span className={`h-3 w-3 rounded-full ${swatchClass}`} />}
      <span className="text-[13px] font-medium text-zinc-100">{title}</span>
      {selected && <Check className="ml-auto h-3.5 w-3.5 text-brand-400" />}
    </span>
    {description && (
      <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">{description}</span>
    )}
  </button>
);
