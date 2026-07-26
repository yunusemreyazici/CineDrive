import React from 'react';
import { Info } from 'lucide-react';
import { SettingsCard } from '../SettingsCard';
import { t } from '../../../i18n';

export const AboutSection: React.FC = () => (
  <SettingsCard
    id="settings-about"
    title={t.settings.about.title}
    description={t.settings.about.description}
    icon={
      <div className="rounded-xl bg-zinc-800/60 p-2.5 text-zinc-400">
        <Info className="h-5 w-5" />
      </div>
    }
    action={
      <span className="rounded-md border border-white/[0.08] bg-zinc-950 px-2.5 py-1 text-[11px] font-semibold text-zinc-400">
        v1.0
      </span>
    }
  >
    <p className="text-xs leading-relaxed text-zinc-500">
      {t.settings.about.body}
    </p>
  </SettingsCard>
);
