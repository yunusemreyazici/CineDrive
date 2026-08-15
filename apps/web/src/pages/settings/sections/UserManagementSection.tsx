import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Trash2, UserPlus, Users } from 'lucide-react';
import {
  useCreateUserMutation,
  useLibrariesQuery,
  useLibraryMembersQuery,
  useRemoveLibraryMemberMutation,
  useResetUserPasswordMutation,
  useSessionQuery,
  useUpdateUserMutation,
  useUpsertLibraryMemberMutation,
  useUsersQuery,
} from '../../../hooks/useApi';
import { toast } from '../../../stores/useToastStore';
import { t } from '../../../i18n';
import { SettingsButton, SettingsCard, SETTINGS_INPUT_CLASSES } from '../SettingsCard';

export const UserManagementSection: React.FC = () => {
  const { data: session } = useSessionQuery();
  const isAdmin = session?.user?.role === 'admin';
  const { data: userData } = useUsersQuery(isAdmin);
  const users = userData?.users || [];
  const createUser = useCreateUserMutation();
  const updateUser = useUpdateUserMutation();
  const resetPassword = useResetUserPasswordMutation();
  const { data: libraries = [] } = useLibrariesQuery();
  const ownedLibraries = libraries.filter((library) => library.accessRole === 'owner');
  const [libraryId, setLibraryId] = useState('');
  const { data: members = [] } = useLibraryMembersQuery(libraryId, isAdmin);
  const upsertMember = useUpsertLibraryMemberMutation();
  const removeMember = useRemoveLibraryMemberMutation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>('user');
  const [memberUserId, setMemberUserId] = useState('');
  const [memberRole, setMemberRole] = useState<'listener' | 'editor'>('listener');

  useEffect(() => {
    if (!libraryId && ownedLibraries[0]) setLibraryId(ownedLibraries[0].id);
  }, [libraryId, ownedLibraries]);

  const availableUsers = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.userId));
    return users.filter((user) => !user.disabled && !memberIds.has(user.id));
  }, [members, users]);

  if (!isAdmin) return null;

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      await createUser.mutateAsync({ name: name.trim(), email: email.trim(), password, role });
      setName('');
      setEmail('');
      setPassword('');
      toast.success(t.settings.users.saved);
    } catch (error) {
      toast.fromError(error, t.settings.users.failed);
    }
  };

  const handleResetPassword = async (id: string) => {
    const next = window.prompt(t.settings.users.password);
    if (!next) return;
    try {
      await resetPassword.mutateAsync({ id, password: next });
      toast.success(t.settings.users.saved);
    } catch (error) {
      toast.fromError(error, t.settings.users.failed);
    }
  };

  const handleGrant = async () => {
    if (!libraryId || !memberUserId) return;
    try {
      await upsertMember.mutateAsync({ libraryId, userId: memberUserId, role: memberRole });
      setMemberUserId('');
      toast.success(t.settings.users.saved);
    } catch (error) {
      toast.fromError(error, t.settings.users.failed);
    }
  };

  return (
    <SettingsCard
      id="settings-users"
      title={t.settings.users.title}
      description={t.settings.users.description}
      icon={Users}
      width="full"
    >
      {userData?.authMode === 'single-user' ? (
        <p className="mb-4 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          {t.settings.users.multiUserDisabled}
        </p>
      ) : null}

      <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-4">
        <input className={SETTINGS_INPUT_CLASSES} value={name} onChange={(event) => setName(event.target.value)} placeholder={t.settings.users.name} required />
        <input className={SETTINGS_INPUT_CLASSES} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={t.settings.users.email} required />
        <input className={SETTINGS_INPUT_CLASSES} type="password" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={t.settings.users.password} required />
        <div className="flex gap-2">
          <select className={SETTINGS_INPUT_CLASSES} value={role} onChange={(event) => setRole(event.target.value as 'admin' | 'user')}>
            <option value="user">{t.settings.users.user}</option>
            <option value="admin">{t.settings.users.admin}</option>
          </select>
          <SettingsButton type="submit" icon={UserPlus} isLoading={createUser.isPending} loadingLabel={t.settings.users.creating}>{t.settings.users.create}</SettingsButton>
        </div>
      </form>

      <div className="mt-5 overflow-x-auto rounded-xl border border-zinc-800/70">
        <table className="w-full min-w-[700px] text-left text-sm">
          <tbody className="divide-y divide-zinc-800/60">
            {users.map((user) => (
              <tr key={user.id}>
                <td className="px-4 py-3"><p className="font-medium text-zinc-200">{user.name}</p><p className="text-xs text-zinc-500">{user.email}</p></td>
                <td className="px-4 py-3">
                  <select
                    className={`${SETTINGS_INPUT_CLASSES} max-w-40`}
                    value={user.role}
                    disabled={user.id === session?.user?.id}
                    onChange={(event) => void updateUser.mutateAsync({ id: user.id, input: { role: event.target.value as 'admin' | 'user' } }).catch((error) => toast.fromError(error, t.settings.users.failed))}
                  >
                    <option value="user">{t.settings.users.user}</option>
                    <option value="admin">{t.settings.users.admin}</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-xs text-zinc-400">{user.disabled ? t.settings.users.disabled : t.settings.users.active}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-2">
                    <SettingsButton icon={KeyRound} onClick={() => void handleResetPassword(user.id)}>{t.settings.users.resetPassword}</SettingsButton>
                    {user.id !== session?.user?.id ? (
                      <SettingsButton onClick={() => void updateUser.mutateAsync({ id: user.id, input: { disabled: !user.disabled } }).catch((error) => toast.fromError(error, t.settings.users.failed))}>
                        {user.disabled ? t.settings.users.active : t.settings.users.disabled}
                      </SettingsButton>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ownedLibraries.length > 0 ? (
        <div className="mt-7 border-t border-zinc-800 pt-5">
          <h4 className="mb-3 text-sm font-semibold text-zinc-200">{t.settings.users.libraryAccess}</h4>
          <div className="grid gap-3 md:grid-cols-4">
            <select className={SETTINGS_INPUT_CLASSES} value={libraryId} onChange={(event) => setLibraryId(event.target.value)}>
              {ownedLibraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
            </select>
            <select className={SETTINGS_INPUT_CLASSES} value={memberUserId} onChange={(event) => setMemberUserId(event.target.value)}>
              <option value="">{t.settings.users.selectUser}</option>
              {availableUsers.map((user) => <option key={user.id} value={user.id}>{user.name} · {user.email}</option>)}
            </select>
            <select className={SETTINGS_INPUT_CLASSES} value={memberRole} onChange={(event) => setMemberRole(event.target.value as 'listener' | 'editor')}>
              <option value="listener">{t.settings.users.listener}</option>
              <option value="editor">{t.settings.users.editor}</option>
            </select>
            <SettingsButton icon={UserPlus} onClick={() => void handleGrant()} disabled={!memberUserId}>{t.settings.users.addAccess}</SettingsButton>
          </div>
          <div className="mt-3 space-y-2">
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between rounded-lg border border-zinc-800/70 px-3 py-2">
                <div><p className="text-sm text-zinc-200">{member.name}</p><p className="text-xs text-zinc-500">{member.email} · {t.settings.users[member.role]}</p></div>
                {member.role !== 'owner' ? <SettingsButton icon={Trash2} onClick={() => void removeMember.mutateAsync({ libraryId, userId: member.userId }).catch((error) => toast.fromError(error, t.settings.users.failed))}>{t.settings.users.removeAccess}</SettingsButton> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </SettingsCard>
  );
};
