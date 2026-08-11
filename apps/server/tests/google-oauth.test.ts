import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { GoogleOAuthService } from '../src/services/google-oauth.service';
import { buildApp } from '../src/app';
import { env } from '../src/config/env';

// Mock googleapis
vi.mock('googleapis', () => {
  const mockOAuth2Client = {
    generateAuthUrl: vi.fn().mockImplementation((opts: { state: string }) => {
      return `https://accounts.google.com/o/oauth2/v2/auth?access_type=offline&prompt=consent&state=${opts.state}`;
    }),
    getToken: vi.fn().mockResolvedValue({
      tokens: {
        access_token: 'mock-access-token',
        refresh_token: 'mock-refresh-token',
        expiry_date: Date.now() + 3600 * 1000,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
      },
    }),
    setCredentials: vi.fn(),
    refreshAccessToken: vi.fn().mockResolvedValue({
      credentials: {
        access_token: 'new-refreshed-access-token',
        expiry_date: Date.now() + 3600 * 1000,
      },
    }),
    revokeToken: vi.fn().mockResolvedValue({}),
  };

  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => mockOAuth2Client),
      },
      oauth2: vi.fn().mockReturnValue({
        userinfo: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: 'google-user-123',
              email: 'testuser@gmail.com',
            },
          }),
        },
      }),
    },
  };
});

describe('GoogleOAuthService Unit Tests', () => {
  let googleService: GoogleOAuthService;
  let mockPrisma: {
    googleConnection: {
      findUnique: ReturnType<typeof vi.fn>;
      findFirst: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      googleConnection: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn().mockResolvedValue([]),
        create: vi.fn().mockResolvedValue({ id: 'conn-1' }),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    googleService = new GoogleOAuthService(
      mockPrisma as unknown as import('@prisma/client').PrismaClient,
    );
  });

  it('should generate and verify valid state token', () => {
    const userId = 'user-uuid-123';
    const stateToken = googleService.generateStateToken(userId);
    expect(stateToken).toBeDefined();

    const verified = googleService.verifyStateToken(stateToken);
    expect(verified.userId).toBe(userId);
  });

  it('should throw error for invalid state token', () => {
    expect(() => googleService.verifyStateToken('invalid-token-format')).toThrow(
      'INVALID_STATE_TOKEN',
    );
  });

  it('should generate Google Auth URL with offline access and state', () => {
    const userId = 'user-uuid-123';
    const authUrl = googleService.generateAuthUrl(userId);

    expect(authUrl).toContain('https://accounts.google.com/o/oauth2/v2/auth');
    expect(authUrl).toContain('access_type=offline');
    expect(authUrl).toContain('prompt=consent');
    expect(authUrl).toContain('state=');
  });

  it('should handle OAuth callback and store encrypted refresh token in DB', async () => {
    const userId = 'user-uuid-123';
    const stateToken = googleService.generateStateToken(userId);

    mockPrisma.googleConnection.findFirst.mockResolvedValue(null);

    const result = await googleService.handleCallback('mock-code-123', stateToken);

    expect(result.userId).toBe(userId);
    expect(result.googleEmail).toBe('testuser@gmail.com');
    expect(mockPrisma.googleConnection.create).toHaveBeenCalled();
  });

  it('should deduplicate concurrent access token refresh requests', async () => {
    const userId = 'user-uuid-123';
    const cryptoService = (
      googleService as unknown as { cryptoService: { encrypt: (s: string) => string } }
    ).cryptoService;
    const mockEncryptedRefreshToken = cryptoService.encrypt('mock-refresh-token');

    mockPrisma.googleConnection.findFirst.mockResolvedValue({
      id: 'conn-1',
      userId,
      googleAccountId: 'google-123',
      email: 'testuser@gmail.com',
      encryptedRefreshToken: mockEncryptedRefreshToken,
      scopes: 'https://www.googleapis.com/auth/drive.readonly',
    });

    // Trigger two concurrent refresh calls for the same user
    const [token1, token2] = await Promise.all([
      googleService.getValidAccessToken(userId),
      googleService.getValidAccessToken(userId),
    ]);

    expect(token1).toBe('new-refreshed-access-token');
    expect(token2).toBe('new-refreshed-access-token');
    // Only 1 database lookup should occur due to promise deduplication
    expect(mockPrisma.googleConnection.findFirst).toHaveBeenCalledTimes(1);
  });

  it('should unlink Google account and revoke token', async () => {
    const userId = 'user-uuid-123';
    const cryptoService = (
      googleService as unknown as { cryptoService: { encrypt: (s: string) => string } }
    ).cryptoService;
    const mockEncryptedRefreshToken = cryptoService.encrypt('mock-refresh-token');

    mockPrisma.googleConnection.findMany.mockResolvedValue([
      {
        id: 'conn-1',
        userId,
        encryptedRefreshToken: mockEncryptedRefreshToken,
      },
    ]);

    await googleService.unlinkGoogleAccount(userId);

    expect(mockPrisma.googleConnection.delete).toHaveBeenCalledWith({
      where: { id: 'conn-1' },
    });
  });
});

describe('Google OAuth Routes Integration Tests', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp();
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('GET /api/auth/google without login should return 401 Unauthorized', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google',
    });

    expect(response.statusCode).toBe(401);
  });

  it('GET /api/auth/google with valid login should redirect to Google Auth URL', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google',
      cookies: {
        session_id: sessionCookie!.value,
      },
    });

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toContain('https://accounts.google.com');
  });

  it('GET /api/auth/google/status with valid login should return connection status', async () => {
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: {
        email: env.ADMIN_EMAIL,
        password: env.ADMIN_PASSWORD,
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'session_id');

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/google/status',
      cookies: {
        session_id: sessionCookie!.value,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body.connected).toBeDefined();
  });

  it('does not unlink a Google account while a Drive scan source still uses it', async () => {
    const owner = await app.authService.ensureAdminUserExists();
    const connection = await app.prisma.googleConnection.create({
      data: {
        userId: owner.id,
        googleAccountId: `guarded-source-${Date.now()}`,
        email: 'guarded-source@cinedrive.test',
        encryptedRefreshToken: 'not-used-by-this-test',
        scopes: 'drive.readonly',
      },
    });
    const library = await app.prisma.library.create({
      data: { userId: owner.id, name: 'Guarded Drive', storageType: 'gdrive' },
    });
    await app.prisma.driveScanSource.create({
      data: {
        libraryId: library.id,
        googleConnectionId: connection.id,
        rootFolderId: 'guarded-folder',
      },
    });
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: env.ADMIN_EMAIL, password: env.ADMIN_PASSWORD },
    });

    const response = await app.inject({
      method: 'DELETE',
      url: `/api/auth/google/connections/${connection.id}`,
      cookies: {
        session_id: loginRes.cookies.find((cookie) => cookie.name === 'session_id')!.value,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error.code).toBe('GOOGLE_CONNECTION_HAS_SOURCES');
    expect(await app.prisma.googleConnection.findUnique({ where: { id: connection.id } })).not.toBeNull();

    await app.prisma.library.delete({ where: { id: library.id } });
    await app.prisma.googleConnection.delete({ where: { id: connection.id } });
  });
});
