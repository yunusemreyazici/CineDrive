import React from 'react';
import { AudioLines, Blend, Gauge, ShieldCheck, SlidersHorizontal, Waves, X } from 'lucide-react';
import { t } from '../../i18n';
import { EQ_FREQUENCIES, type EqPreset } from './musicAudio';
import { useMusicPlayer } from './MusicPlayerProvider';

interface Props {
  onClose: () => void;
}

const PRESETS: Array<Exclude<EqPreset, 'custom'>> = ['flat', 'bass', 'vocal', 'treble', 'night'];

const Toggle: React.FC<{
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}> = ({ checked, onChange, label }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    onClick={() => onChange(!checked)}
    className={`relative h-7 w-12 shrink-0 rounded-full border transition ${
      checked ? 'border-cyan-300/50 bg-cyan-400' : 'border-white/15 bg-white/10'
    }`}
  >
    <span
      className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-5' : 'translate-x-0.5'
      }`}
    />
  </button>
);

const frequencyLabel = (frequency: number) =>
  frequency >= 1000 ? `${frequency / 1000}k` : String(frequency);

export const MusicAudioSettingsPanel: React.FC<Props> = ({ onClose }) => {
  const player = useMusicPlayer();
  const settings = player.audioSettings;

  return (
    <aside
      role="dialog"
      aria-modal="true"
      aria-label={t.music.audioSettings}
      className="fixed inset-x-3 bottom-3 top-3 z-[100] ml-auto flex w-[min(480px,calc(100vw-24px))] flex-col overflow-hidden rounded-[28px] border border-white/10 bg-[#090b0e]/95 text-white shadow-[0_30px_100px_rgba(0,0,0,.75)] backdrop-blur-2xl sm:inset-y-5 sm:right-5"
    >
      <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="rounded-xl bg-cyan-400/15 p-2 text-cyan-300">
            <SlidersHorizontal className="h-5 w-5" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold">{t.music.audioSettings}</h2>
            <p className="text-xs text-white/45">{t.music.audioSettingsHint}</p>
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label={t.common.close}
          className="rounded-full p-2 text-white/60 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{t.music.loudnessNormalization}</h3>
              <p className="mt-1 text-xs leading-relaxed text-white/45">{t.music.loudnessHint}</p>
            </div>
            <Toggle
              checked={settings.normalizationEnabled}
              onChange={(normalizationEnabled) =>
                player.updateAudioSettings({ normalizationEnabled })
              }
              label={t.music.loudnessNormalization}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <div className="flex items-center gap-3">
            <Waves className="h-5 w-5 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{t.music.gaplessPlayback}</h3>
              <p className="mt-1 text-xs leading-relaxed text-white/45">{t.music.gaplessHint}</p>
            </div>
            <Toggle
              checked={settings.gaplessEnabled}
              onChange={(gaplessEnabled) => player.updateAudioSettings({ gaplessEnabled })}
              label={t.music.gaplessPlayback}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <div className="flex items-center gap-3">
            <Blend className="h-5 w-5 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{t.music.crossfade}</h3>
              <p className="mt-1 text-xs text-white/45">{t.music.crossfadeHint}</p>
            </div>
            <span className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-bold tabular-nums">
              {settings.crossfadeSeconds === 0
                ? t.music.off
                : `${settings.crossfadeSeconds} ${t.music.secondsShort}`}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-7 gap-1.5" aria-label={t.music.crossfade}>
            {[0, 5, 6, 7, 8, 9, 10].map((seconds) => (
              <button
                key={seconds}
                type="button"
                onClick={() => player.updateAudioSettings({ crossfadeSeconds: seconds })}
                aria-pressed={settings.crossfadeSeconds === seconds}
                className={`rounded-lg py-2 text-xs font-semibold transition ${
                  settings.crossfadeSeconds === seconds
                    ? 'bg-cyan-400 text-black'
                    : 'bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white'
                }`}
              >
                {seconds === 0 ? '0' : seconds}
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
          <div className="flex items-center gap-3">
            <AudioLines className="h-5 w-5 text-cyan-300" />
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-semibold">{t.music.equalizer}</h3>
              <p className="mt-1 text-xs text-white/45">{t.music.equalizerHint}</p>
            </div>
            <Toggle
              checked={settings.equalizerEnabled}
              onChange={(equalizerEnabled) => player.updateAudioSettings({ equalizerEnabled })}
              label={t.music.equalizer}
            />
          </div>

          <div className="mt-4 flex flex-wrap gap-1.5">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => player.setEqPreset(preset)}
                aria-pressed={settings.eqPreset === preset}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                  settings.eqPreset === preset
                    ? 'bg-cyan-400 text-black'
                    : 'bg-white/[0.06] text-white/55 hover:bg-white/10 hover:text-white'
                }`}
              >
                {t.music.eqPresets[preset]}
              </button>
            ))}
          </div>

          <div
            className={`mt-5 grid grid-cols-5 gap-2 transition ${settings.equalizerEnabled ? '' : 'opacity-35'}`}
          >
            {EQ_FREQUENCIES.map((frequency, index) => (
              <label key={frequency} className="flex min-w-0 flex-col items-center gap-2">
                <span className="text-[10px] font-semibold tabular-nums text-white/55">
                  {(settings.eqGains[index] || 0) > 0 ? '+' : ''}
                  {settings.eqGains[index] || 0} dB
                </span>
                <input
                  type="range"
                  min={-12}
                  max={12}
                  step={1}
                  value={settings.eqGains[index] || 0}
                  disabled={!settings.equalizerEnabled}
                  onChange={(event) => player.setEqBand(index, Number(event.target.value))}
                  aria-label={`${frequencyLabel(frequency)} Hz`}
                  className="music-range w-full"
                />
                <span className="text-[10px] font-bold uppercase tracking-wide text-white/35">
                  {frequencyLabel(frequency)}
                </span>
              </label>
            ))}
          </div>
        </section>

        <div className="flex items-start gap-3 rounded-2xl border border-cyan-300/15 bg-cyan-400/[0.06] p-4 text-xs leading-relaxed text-white/50">
          <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-cyan-300" />
          <p>{t.music.audioEngineHint}</p>
        </div>
      </div>
    </aside>
  );
};
