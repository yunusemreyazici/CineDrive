import React from 'react';
import { Info, Mail } from 'lucide-react';
import { SettingsCard, SettingsStatus } from '../SettingsCard';
import { t } from '../../../i18n';

const DEVELOPER_NAME = 'Yunus Emre YAZICI';
const GITHUB_URL = 'https://github.com/yunusemreyazici';
const X_URL = 'https://x.com/gptemre';
const EMAIL = 'mail@yunusemreyazici.com';

/** Lucide removed brand icons in v1, so the GitHub mark is inlined. */
const GithubLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
  </svg>
);

/** Lucide's `X` is the close glyph, so the wordmark is inlined. */
const XLogo: React.FC<{ className?: string }> = ({ className }) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" className={className}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

interface ProfileLinkProps {
  href: string;
  label: string;
  ariaLabel: string;
  className: string;
  children: React.ReactNode;
}

const ProfileLink: React.FC<ProfileLinkProps> = ({
  href,
  label,
  ariaLabel,
  className,
  children,
}) => (
  <a
    href={href}
    // Outbound links open away from the app; `noreferrer` keeps the opener
    // handle out of the destination's reach.
    target="_blank"
    rel="noopener noreferrer"
    aria-label={ariaLabel}
    className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-xs font-bold uppercase tracking-wider transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 ${className}`}
  >
    {children}
    {label}
  </a>
);

export const AboutSection: React.FC = () => (
  <SettingsCard
    id="settings-about"
    title={t.settings.about.title}
    description={t.settings.about.description}
    icon={Info}
    width="full"
    action={<SettingsStatus tone="neutral">v1.0</SettingsStatus>}
  >
    <div className="space-y-8">
      <p className="max-w-prose text-[13px] leading-relaxed text-zinc-500">
        {t.settings.about.body}
      </p>

      <div className="flex flex-col items-center gap-4 border-t border-zinc-800/60 pt-8 text-center">
        <h4 className="font-display text-2xl font-extrabold tracking-tight text-white">
          {DEVELOPER_NAME}
        </h4>

        <span className="rounded-md bg-zinc-800 px-2.5 py-1 font-mono text-xs text-zinc-300">
          {t.settings.about.developerRole}
        </span>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <ProfileLink
            href={GITHUB_URL}
            label={t.settings.about.linkGithub}
            ariaLabel={t.settings.about.linkLabel(t.settings.about.linkGithub)}
            className="bg-zinc-900 text-white"
          >
            <GithubLogo className="h-4 w-4" />
          </ProfileLink>

          <ProfileLink
            href={X_URL}
            label={t.settings.about.linkX}
            ariaLabel={t.settings.about.linkLabel(t.settings.about.linkX)}
            className="bg-black text-white"
          >
            <XLogo className="h-3.5 w-3.5" />
          </ProfileLink>

          <ProfileLink
            href={`mailto:${EMAIL}`}
            label={t.settings.about.linkMail}
            ariaLabel={t.settings.about.mailLabel}
            className="bg-zinc-900 text-white"
          >
            <Mail className="h-4 w-4 text-rose-400" />
          </ProfileLink>
        </div>

        <p className="text-[13px] italic text-zinc-500">{t.settings.about.developerQuote}</p>
      </div>
    </div>
  </SettingsCard>
);
