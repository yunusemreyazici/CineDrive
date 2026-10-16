import { LayoutGrid, List } from 'lucide-react';
import { t } from '../../i18n';
import type { useCatalogueLayout } from '../../hooks/useCatalogueLayout';

export function CatalogueLayoutControls({
  layout,
}: {
  layout: ReturnType<typeof useCatalogueLayout>;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-3"
      role="group"
      aria-label={t.catalogueLayout.title}
    >
      <div className="flex rounded-lg border border-zinc-800 p-0.5">
        {(['grid', 'list'] as const).map((mode) => {
          const Icon = mode === 'grid' ? LayoutGrid : List;
          return (
            <button
              key={mode}
              type="button"
              disabled={!layout.available}
              aria-label={mode === 'grid' ? t.library.gridView : t.library.listView}
              aria-pressed={layout.mode === mode}
              className={`rounded-md p-2 ${layout.mode === mode ? 'bg-zinc-800 text-white' : 'text-zinc-400'}`}
              onClick={() => layout.update({ mode })}
            >
              <Icon className="h-4 w-4" />
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-xs text-zinc-400">
        {t.catalogueLayout.posterSize}
        <select
          className="cd-field px-2 py-2 text-sm"
          value={layout.size}
          disabled={!layout.available || layout.mode === 'list'}
          onChange={(event) => {
            const size = event.target.value;
            if (size === 'small' || size === 'medium' || size === 'large') layout.update({ size });
          }}
        >
          <option value="small">{t.catalogueLayout.small}</option>
          <option value="medium">{t.catalogueLayout.medium}</option>
          <option value="large">{t.catalogueLayout.large}</option>
        </select>
      </label>
      <p className="text-xs text-zinc-500" role={layout.failed ? 'status' : undefined}>
        {layout.failed ? t.catalogueLayout.notSaved : t.catalogueLayout.hint}
      </p>
    </div>
  );
}
