import { google } from 'googleapis';
import crypto from 'crypto';
import type { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { CryptoService } from './crypto.service.js';

interface CachedAccessToken {
  accessToken: string;
  expiresAt: number;
}

const STATE_EXPIRATION_MS = 10 * 60 * 1000; // 10 minutes
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiration

export const GOOGLE_DRIVE_SCOPES = [
  'https://www.googleapis.com/auth/drive.readonly',
  'https://www.googleapis.com/auth/userinfo.email',
];

export class GoogleOAuthService {
  private cryptoService: CryptoService;
  private tokenCache = new Map<string, CachedAccessToken>();
  private refreshPromises = new Map<string, Promise<string>>();

  constructor(private prisma: PrismaClient) {
    this.cryptoService = new CryptoService(env.TOKEN_ENCRYPTION_KEY);
  }

  private createOAuth2Client() {
    return new google.auth.OAuth2(
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
      env.GOOGLE_REDIRECT_URI,
    );
  }

  /**
   * Generates a signed, encrypted state token to prevent CSRF in OAuth callback
   */
  public generateStateToken(userId: string): string {
    const payload = JSON.stringify({
      userId,
      timestamp: Date.now(),
      nonce: crypto.randomBytes(16).toString('hex'),
    });
    return this.cryptoService.encrypt(payload);
  }

  /**
   * Validates state token and returns userId if valid and not expired
   */
  public verifyStateToken(stateToken: string): { userId: string } {
    try {
      const decrypted = this.cryptoService.decrypt(stateToken);
      const parsed = JSON.parse(decrypted) as { userId: string; timestamp: number };

      if (!parsed.userId || !parsed.timestamp) {
        throw new Error('INVALID_STATE');
      }

      if (Date.now() - parsed.timestamp > STATE_EXPIRATION_MS) {
        throw new Error('STATE_EXPIRED');
      }

      return { userId: parsed.userId };
    } catch {
      throw new Error('INVALID_STATE_TOKEN');
    }
  }

  /**
   * Generates Google OAuth consent screen URL
   */
  public generateAuthUrl(userId: string): string {
    const oauth2Client = this.createOAuth2Client();
    const state = this.generateStateToken(userId);

    return oauth2Client.generateAuthUrl({
      access_type: 'offline',
      prompt: 'select_account consent',
      scope: GOOGLE_DRIVE_SCOPES,
      state,
    });
  }

  /**
   * Handles Google OAuth callback: verifies state, exchanges code for tokens, encrypts refresh token, saves to DB
   */
  public async handleCallback(
    code: string,
    stateToken: string,
  ): Promise<{ userId: string; googleEmail: string }> {
    const { userId } = this.verifyStateToken(stateToken);

    const oauth2Client = this.createOAuth2Client();
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token) {
      throw new Error('NO_ACCESS_TOKEN');
    }

    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();

    const googleAccountId = userInfo.data.id || '';
    const googleEmail = userInfo.data.email || '';

    if (!googleEmail) {
      throw new Error('NO_GOOGLE_EMAIL');
    }

    // Retrieve refresh token: fallback to existing DB refresh token if Google didn't issue a new one
    let refreshToken = tokens.refresh_token;
    if (!refreshToken) {
      const existingConn = await this.prisma.googleConnection.findFirst({
        where: { userId, email: googleEmail },
      });
      if (existingConn) {
        refreshToken = this.cryptoService.decrypt(existingConn.encryptedRefreshToken);
      }
    }

    if (!refreshToken) {
      throw new Error('NO_REFRESH_TOKEN_AVAILABLE');
    }

    const encryptedRefreshToken = this.cryptoService.encrypt(refreshToken);
    const scopes = (tokens.scope || GOOGLE_DRIVE_SCOPES.join(' ')).toString();

    // Check if this connection already exists for user
    const existing = await this.prisma.googleConnection.findFirst({
      where: { userId, email: googleEmail },
    });

    let connectionId = existing?.id;
    if (existing) {
      await this.prisma.googleConnection.update({
        where: { id: existing.id },
        data: {
          googleAccountId,
          encryptedRefreshToken,
          scopes,
        },
      });
    } else {
      const created = await this.prisma.googleConnection.create({
        data: {
          userId,
          googleAccountId,
          email: googleEmail,
          encryptedRefreshToken,
          scopes,
        },
      });
      connectionId = created.id;
    }

    // Cache Access Token in memory
    const expiresAt = tokens.expiry_date || Date.now() + 3600 * 1000;
    this.tokenCache.set(connectionId!, {
      accessToken: tokens.access_token,
      expiresAt,
    });
    this.tokenCache.set(userId, {
      accessToken: tokens.access_token,
      expiresAt,
    });

    return { userId, googleEmail };
  }

  /**
   * Returns a valid access token for the given user (or specific connectionId), automatically refreshing if expired.
   */
  public async getValidAccessToken(userId: string, connectionId?: string): Promise<string> {
    const key = connectionId || userId;
    const cached = this.tokenCache.get(key);
    if (cached && cached.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
      return cached.accessToken;
    }

    const existingPromise = this.refreshPromises.get(key);
    if (existingPromise) {
      return existingPromise;
    }

    const refreshPromise = this.performTokenRefresh(userId, connectionId).finally(() => {
      this.refreshPromises.delete(key);
    });

    this.refreshPromises.set(key, refreshPromise);
    return refreshPromise;
  }

  private async performTokenRefresh(userId: string, connectionId?: string): Promise<string> {
    let connection = connectionId
      ? await this.prisma.googleConnection.findFirst({ where: { id: connectionId, userId } })
      : null;

    if (!connection) {
      connection = await this.prisma.googleConnection.findFirst({ where: { userId } });
    }

    if (!connection) {
      throw new Error('GOOGLE_ACCOUNT_NOT_CONNECTED');
    }

    let refreshToken: string;
    try {
      refreshToken = this.cryptoService.decrypt(connection.encryptedRefreshToken);
    } catch {
      throw new Error('TOKEN_DECRYPTION_FAILED');
    }

    const oauth2Client = this.createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    try {
      const { credentials } = await oauth2Client.refreshAccessToken();

      if (!credentials.access_token) {
        throw new Error('REFRESH_FAILED');
      }

      const expiresAt = credentials.expiry_date || Date.now() + 3600 * 1000;

      // Update in-memory cache
      this.tokenCache.set(connection.id, {
        accessToken: credentials.access_token,
        expiresAt,
      });
      this.tokenCache.set(userId, {
        accessToken: credentials.access_token,
        expiresAt,
      });

      // If Google returned a new refresh token, update encrypted storage in DB
      if (credentials.refresh_token) {
        const encryptedRefreshToken = this.cryptoService.encrypt(credentials.refresh_token);
        await this.prisma.googleConnection.update({
          where: { id: connection.id },
          data: { encryptedRefreshToken },
        });
      }

      return credentials.access_token;
    } catch {
      this.tokenCache.delete(connection.id);
      this.tokenCache.delete(userId);
      throw new Error('GOOGLE_REAUTHORIZATION_REQUIRED');
    }
  }

  /**
   * Unlinks a specific Google Account or all connections for user
   */
  public async unlinkGoogleAccount(userId: string, connectionId?: string): Promise<void> {
    const connections = connectionId
      ? await this.prisma.googleConnection.findMany({ where: { id: connectionId, userId } })
      : await this.prisma.googleConnection.findMany({ where: { userId } });

    for (const connection of connections) {
      try {
        const refreshToken = this.cryptoService.decrypt(connection.encryptedRefreshToken);
        const oauth2Client = this.createOAuth2Client();
        await oauth2Client.revokeToken(refreshToken);
      } catch {
        // Ignore revocation errors
      }

      await this.prisma.googleConnection.delete({
        where: { id: connection.id },
      });

      this.tokenCache.delete(connection.id);
    }

    this.tokenCache.delete(userId);
  }

  /**
   * Returns list of connected Google Accounts for user
   */
  public async getConnectionsInfo(userId: string) {
    const connections = await this.prisma.googleConnection.findMany({
      where: { userId },
      select: {
        id: true,
        email: true,
        googleAccountId: true,
        scopes: true,
        createdAt: true,
      },
    });

    return connections.map((conn) => ({
      id: conn.id,
      email: conn.email,
      googleAccountId: conn.googleAccountId,
      scopes: conn.scopes.split(' '),
      createdAt: conn.createdAt.toISOString(),
    }));
  }

  public async getConnectionInfo(userId: string) {
    const list = await this.getConnectionsInfo(userId);
    return list[0] || null;
  }
}
