import { useGoogleStatusQuery, useGoogleConnectionsQuery } from '../../hooks/useApi';
import { t } from '../../i18n';

export interface GoogleConnection {
  id?: string;
  email?: string;
  googleEmail?: string;
}

/**
 * The status endpoint and the connections endpoint can each be the one that has
 * loaded first, so both are merged into a single list.
 */
export const useGoogleConnections = (): GoogleConnection[] => {
  const { data: googleStatus } = useGoogleStatusQuery();
  const { data: connections = [] } = useGoogleConnectionsQuery();

  if (connections.length > 0) return connections;
  if (googleStatus?.connections?.length) return googleStatus.connections;
  return googleStatus?.connection ? [googleStatus.connection as GoogleConnection] : [];
};

export const connectionLabel = (connection: GoogleConnection, index: number) =>
  connection.email || connection.googleEmail || t.settings.google.fallbackAccountName(index + 1);
