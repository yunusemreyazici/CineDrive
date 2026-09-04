import { Link } from 'react-router-dom';
import { useSessionQuery } from '../../hooks/useApi';
import { copy } from './copy';

export function SetupEntry() {
  const session = useSessionQuery();
  if (session.data?.user?.role !== 'admin') return null;
  return (
    <Link
      to="/setup"
      className="my-4 inline-flex rounded-lg border border-brand-500/30 bg-brand-500/10 px-4 py-3 text-sm font-semibold text-brand-300 focus-visible:outline focus-visible:outline-2"
    >
      {copy.title} →
    </Link>
  );
}
