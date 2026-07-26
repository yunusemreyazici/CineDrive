import React from 'react';
import { Github, Info, Mail } from 'lucide-react';
import { SettingsCard, SettingsStatus } from '../SettingsCard';
import { t } from '../../../i18n';

const DEVELOPER_NAME = 'Yunus Emre YAZICI';
const GITHUB_URL = 'https://github.com/yunusemreyazici';
const X_URL = 'https://x.com/gptemre';
const EMAIL = 'mail@yunusemreyazici.com';

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
            <Github className="h-4 w-4" />
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
