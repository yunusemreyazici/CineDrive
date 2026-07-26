import React from 'react';
import { Info } from 'lucide-react';
import { SettingsCard, SettingsStatus } from '../SettingsCard';
import { t } from '../../../i18n';

export const AboutSection: React.FC = () => (
  <SettingsCard
    id="settings-about"
    title={t.settings.about.title}
    description={t.settings.about.description}
    icon={Info}
    action={<SettingsStatus tone="neutral">v1.0</SettingsStatus>}
  >
    <p className="max-w-prose text-[13px] leading-relaxed text-zinc-500">{t.settings.about.body}</p>
  </SettingsCard>
);
