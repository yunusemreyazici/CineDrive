import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Cloud, HardDrive } from 'lucide-react';
import {
  useSessionQuery,
  useLibrariesQuery,
  useGoogleConnectionsQuery,
  useDriveScanSourcesQuery,
  useValidateLocalFolderMutation,
  useValidateDriveScanSourceMutation,
  useCreateLibraryMutation,
  useCreateDriveScanSourceMutation,
} from '../hooks/useApi';
import { SettingsButton, SettingsField, SETTINGS_INPUT_CLASSES } from './settings/SettingsCard';
import { copy as c } from './setup/copy';
import { SetupScan } from './setup/SetupScan';

export function SetupPage() {
  const session = useSessionQuery();
  if (session.isPending) return <p role="status">{c.busy}</p>;
  if (session.isError) return <p role="alert">{c.loadError}</p>;
  if (session.data?.user?.role !== 'admin') return <p role="alert">{c.admin}</p>;
  return <SetupWorkspace />;
}

function SetupWorkspace() {
  const [params, setParams] = useSearchParams();
  const libraries = useLibrariesQuery();
  const driveLibrary = libraries.data?.find(
    (library) => library.storageType === 'gdrive' && library.accessRole === 'owner',
  );
  const sources = useDriveScanSourcesQuery(driveLibrary?.id);
  const connections = useGoogleConnectionsQuery();
  const validateLocal = useValidateLocalFolderMutation();
  const validateDrive = useValidateDriveScanSourceMutation();
  const createLocal = useCreateLibraryMutation();
  const createDrive = useCreateDriveScanSourceMutation();
  const [kind, setKind] = useState<'local' | 'gdrive'>('local');
  const [step, setStep] = useState(0);
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [connectionId, setConnectionId] = useState('');
  const [verifiedName, setVerifiedName] = useState('');
  const [error, setError] = useState('');
  const busy =
    validateLocal.isPending ||
    validateDrive.isPending ||
    createLocal.isPending ||
    createDrive.isPending;
  const libraryId = params.get('library');
  const sourceId = params.get('source') || undefined;
  const savedLibrary = libraries.data?.find(
    (library) => library.id === libraryId && library.accessRole === 'owner',
  );
  const validTarget =
    savedLibrary &&
    (savedLibrary.storageType === 'local'
      ? !sourceId
      : savedLibrary.id === driveLibrary?.id &&
        sources.data?.some((source) => source.id === sourceId));
  const currentStep = libraryId ? 3 : step;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [currentStep]);

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    try {
      if (kind === 'local') {
        await validateLocal.mutateAsync({ localFolderPath: location.trim() });
        setVerifiedName(name.trim());
      } else {
        if (!driveLibrary) throw new Error('Missing Drive library');
        const result = await validateDrive.mutateAsync({
          libraryId: driveLibrary.id,
          googleConnectionId: connectionId,
          rootFolderId: location.trim(),
        });
        setVerifiedName(result.folderName);
      }
      setStep(2);
    } catch {
      setError(c.accessError);
    }
  }

  async function create() {
    setError('');
    try {
      if (kind === 'local') {
        const library = await createLocal.mutateAsync({
          name: name.trim(),
          storageType: 'local',
          rootFolderId: '',
          localFolderPath: location.trim(),
        });
        setParams({ library: library.id }, { replace: true });
      } else {
        if (!driveLibrary) return;
        const source = await createDrive.mutateAsync({
          libraryId: driveLibrary.id,
          googleConnectionId: connectionId,
          rootFolderId: location.trim(),
        });
        setParams({ library: driveLibrary.id, source: source.id }, { replace: true });
      }
      // Persist the saved identity in the URL before another request can fail.
      // Retrying a scan never re-runs creation.
      await libraries.refetch();
      await sources.refetch();
    } catch {
      setError(c.createError);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <header>
        <h1 ref={heading} tabIndex={-1} className="font-display text-3xl font-bold text-white">
          {c.title}
        </h1>
        <p className="mt-2 text-zinc-400">{c.subtitle}</p>
      </header>
      <ol aria-label={c.title} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[c.source, c.details, c.review, c.scan].map((label, index) => (
          <li
            key={label}
            aria-current={currentStep === index ? 'step' : undefined}
            className={`rounded-lg border p-3 text-sm ${currentStep === index ? 'border-brand-500 bg-brand-500/10 text-brand-300' : 'border-zinc-800 text-zinc-500'}`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>
      <section className="rounded-2xl border border-zinc-800 bg-zinc-950/40 p-5 sm:p-8">
        {libraries.isPending ||
        (libraryId && !savedLibrary && libraries.isFetching) ||
        (libraryId &&
          savedLibrary?.storageType === 'gdrive' &&
          (sources.isPending || (!validTarget && sources.isFetching))) ? (
          <p role="status">{c.busy}</p>
        ) : libraries.isError ||
          (libraryId && sources.isError && savedLibrary?.storageType === 'gdrive') ? (
          <div role="alert">
            {c.loadError}
            <SettingsButton
              onClick={() => {
                void libraries.refetch();
                void sources.refetch();
              }}
            >
              {c.refresh}
            </SettingsButton>
          </div>
        ) : libraryId ? (
          validTarget && savedLibrary ? (
            <SetupScan
              key={`${libraryId}-${sourceId}`}
              library={savedLibrary}
              sourceId={sourceId}
            />
          ) : (
            <p role="alert">{c.missing}</p>
          )
        ) : (
          <>
            {step === 0 && (
              <fieldset className="space-y-4">
                <legend className="mb-4 text-lg font-semibold text-white">{c.source}</legend>
                {(['local', 'gdrive'] as const).map((value) => {
                  const Icon = value === 'local' ? HardDrive : Cloud;
                  return (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 ${kind === value ? 'border-brand-500 bg-brand-500/5' : 'border-zinc-800'}`}
                    >
                      <input
                        type="radio"
                        name="source-kind"
                        value={value}
                        checked={kind === value}
                        onChange={() => {
                          setKind(value);
                          setLocation('');
                          setError('');
                        }}
                        className="mt-1"
                      />
                      <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-brand-400" />
                      <span>
                        <span className="block font-semibold text-white">
                          {value === 'local' ? c.local : c.drive}
                        </span>
                        <span className="mt-1 block text-sm text-zinc-400">
                          {value === 'local' ? c.localHint : c.driveHint}
                        </span>
                      </span>
                    </label>
                  );
                })}
                <SettingsButton onClick={() => setStep(1)}>{c.next}</SettingsButton>
              </fieldset>
            )}
            {step === 1 && (
              <form onSubmit={(event) => void verify(event)}>
                <fieldset disabled={busy} className="space-y-5">
                  <legend className="mb-4 text-lg font-semibold text-white">{c.details}</legend>
                  {kind === 'local' ? (
                    <>
                      <SettingsField id="setup-name" label={c.name}>
                        <input
                          id="setup-name"
                          required
                          maxLength={200}
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                          className={SETTINGS_INPUT_CLASSES}
                        />
                      </SettingsField>
                      <p id="setup-location-hint" className="text-sm text-zinc-400">
                        {c.pathHint}
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-zinc-400">{c.connectHint}</p>
                      <a
                        className="inline-block text-brand-300 underline"
                        href="/api/auth/google"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {c.connect}
                      </a>
                      <SettingsButton
                        type="button"
                        variant="secondary"
                        disabled={connections.isFetching}
                        onClick={() => void connections.refetch()}
                      >
                        {c.refreshAccounts}
                      </SettingsButton>
                      {connections.isError && <p role="alert">{c.loadError}</p>}
                      {connections.isPending && <p role="status">{c.busy}</p>}
                      <SettingsField id="setup-account" label={c.account}>
                        <select
                          id="setup-account"
                          required
                          value={connectionId}
                          onChange={(event) => setConnectionId(event.target.value)}
                          className={SETTINGS_INPUT_CLASSES}
                        >
                          <option value="">{c.select}</option>
                          {connections.data?.map((connection) => (
                            <option key={connection.id} value={connection.id}>
                              {connection.email}
                            </option>
                          ))}
                        </select>
                      </SettingsField>
                      <p id="setup-location-hint" className="text-sm text-zinc-400">
                        {c.folderHint}
                      </p>
                    </>
                  )}
                  <SettingsField id="setup-location" label={kind === 'local' ? c.path : c.folder}>
                    <input
                      id="setup-location"
                      required
                      maxLength={4096}
                      aria-describedby="setup-location-hint"
                      value={location}
                      onChange={(event) => setLocation(event.target.value)}
                      className={SETTINGS_INPUT_CLASSES}
                      placeholder={kind === 'local' ? '/media/films' : ''}
                    />
                  </SettingsField>
                  <div className="flex gap-3">
                    <SettingsButton
                      type="button"
                      variant="secondary"
                      onClick={() => {
                        setStep(0);
                        setError('');
                      }}
                    >
                      {c.back}
                    </SettingsButton>
                    <SettingsButton
                      type="submit"
                      disabled={
                        !location.trim() ||
                        (kind === 'local' ? !name.trim() : !connectionId || !driveLibrary)
                      }
                      isLoading={busy}
                      loadingLabel={c.busy}
                    >
                      {c.verify}
                    </SettingsButton>
                  </div>
                </fieldset>
              </form>
            )}
            {step === 2 && (
              <div className="space-y-5">
                <h2 className="font-semibold text-emerald-300">{c.verified}</h2>
                <p className="break-words text-lg text-white">{verifiedName}</p>
                <p className="break-all font-mono text-sm text-zinc-400">{location.trim()}</p>
                <p className="text-sm text-zinc-400">{c.shallow}</p>
                <p className="text-sm text-zinc-400">{c.createHint}</p>
                <div className="flex gap-3">
                  <SettingsButton
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      setStep(1);
                      setError('');
                    }}
                  >
                    {c.back}
                  </SettingsButton>
                  <SettingsButton
                    isLoading={busy}
                    loadingLabel={c.creating}
                    disabled={busy}
                    onClick={() => void create()}
                  >
                    {c.create}
                  </SettingsButton>
                </div>
              </div>
            )}
            {error && (
              <p role="alert" className="mt-4 text-sm text-rose-300">
                {error}
              </p>
            )}
          </>
        )}
      </section>
      {!libraryId &&
        (libraries.data?.some(
          (library) => library.storageType === 'local' && library.accessRole === 'owner',
        ) ||
          !!sources.data?.length) && (
          <section className="space-y-3">
            <h2 className="text-lg font-semibold text-white">{c.resume}</h2>
            <p className="text-sm text-zinc-400">{c.resumeHint}</p>
            <ul className="space-y-2">
              {libraries.data
                ?.filter(
                  (library) => library.storageType === 'local' && library.accessRole === 'owner',
                )
                .map((library) => (
                  <li key={library.id}>
                    <Link
                      className="text-brand-300 underline"
                      to={`/setup?library=${encodeURIComponent(library.id)}`}
                    >
                      {library.name}
                    </Link>
                  </li>
                ))}
              {sources.data?.map((source) => (
                <li key={source.id}>
                  <Link
                    className="text-brand-300 underline"
                    to={`/setup?library=${encodeURIComponent(source.libraryId)}&source=${encodeURIComponent(source.id)}`}
                  >
                    {source.folderName || source.rootFolderId}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      <footer className="flex flex-wrap gap-5 text-sm">
        <Link className="text-zinc-400 underline" to="/">
          {c.later}
        </Link>
        <Link className="text-brand-300 underline" to="/settings?tab=libraries">
          {c.settings}
        </Link>
      </footer>
    </div>
  );
}
