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
      prompt: 'consent',
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
      const existingConn = await this.prisma.googleConnection.findUnique({
        where: { userId },
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

    // Save to Database
    await this.prisma.googleConnection.upsert({
      where: { userId },
      create: {
        userId,
        googleAccountId,
        email: googleEmail,
        encryptedRefreshToken,
        scopes,
      },
      update: {
        googleAccountId,
        email: googleEmail,
        encryptedRefreshToken,
        scopes,
      },
    });

    // Cache Access Token in memory
    const expiresAt = tokens.expiry_date || Date.now() + 3600 * 1000;
    this.tokenCache.set(userId, {
      accessToken: tokens.access_token,
      expiresAt,
    });

    return { userId, googleEmail };
  }

  /**
   * Returns a valid access token for the given user, automatically refreshing if expired.
   * Concurrency Safe: Merges concurrent refresh requests for the same user into a single operation.
   */
  public async getValidAccessToken(userId: string): Promise<string> {
    const cached = this.tokenCache.get(userId);
    if (cached && cached.expiresAt - Date.now() > REFRESH_BUFFER_MS) {
      return cached.accessToken;
    }

    // Deduplicate in-flight refresh requests for the same user
    const existingPromise = this.refreshPromises.get(userId);
    if (existingPromise) {
      return existingPromise;
    }

    const refreshPromise = this.performTokenRefresh(userId).finally(() => {
      this.refreshPromises.delete(userId);
    });

    this.refreshPromises.set(userId, refreshPromise);
    return refreshPromise;
  }

  private async performTokenRefresh(userId: string): Promise<string> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
    });

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
      this.tokenCache.set(userId, {
        accessToken: credentials.access_token,
        expiresAt,
      });

      // If Google returned a new refresh token, update encrypted storage in DB
      if (credentials.refresh_token) {
        const encryptedRefreshToken = this.cryptoService.encrypt(credentials.refresh_token);
        await this.prisma.googleConnection.update({
          where: { userId },
          data: { encryptedRefreshToken },
        });
      }

      return credentials.access_token;
    } catch {
      // Handle revoked token or authentication failure
      this.tokenCache.delete(userId);
      throw new Error('GOOGLE_REAUTHORIZATION_REQUIRED');
    }
  }

  /**
   * Unlinks Google Account: revokes tokens at Google endpoint and removes database record
   */
  public async unlinkGoogleAccount(userId: string): Promise<void> {
    const connection = await this.prisma.googleConnection.findUnique({
      where: { userId },
    });

    if (!connection) {
      return;
    }

    try {
      const refreshToken = this.cryptoService.decrypt(connection.encryptedRefreshToken);
      const oauth2Client = this.createOAuth2Client();
      await oauth2Client.revokeToken(refreshToken);
    } catch {
      // Ignore revocation network errors if token was already revoked
    }

    await this.prisma.googleConnection.delete({
      where: { userId },
    });

    this.tokenCache.delete(userId);
  }

  /**
   * Returns current GoogleConnection info for user without exposing secrets
   */
  public async getConnectionInfo(userId: string) {
    const conn = await this.prisma.googleConnection.findUnique({
      where: { userId },
      select: {
        id: true,
        email: true,
        googleAccountId: true,
        scopes: true,
        createdAt: true,
      },
    });

    if (!conn) return null;

    return {
      id: conn.id,
      email: conn.email,
      googleAccountId: conn.googleAccountId,
      scopes: conn.scopes.split(' '),
      createdAt: conn.createdAt.toISOString(),
    };
  }
}
