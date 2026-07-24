import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleOAuthService } from '../src/services/google-oauth.service';

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
      upsert: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      delete: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    mockPrisma = {
      googleConnection: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
    };
    googleService = new GoogleOAuthService(mockPrisma as unknown as import('@prisma/client').PrismaClient);
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

    const result = await googleService.handleCallback('mock-code-123', stateToken);

    expect(result.userId).toBe(userId);
    expect(result.googleEmail).toBe('testuser@gmail.com');
    expect(mockPrisma.googleConnection.upsert).toHaveBeenCalled();
  });

  it('should deduplicate concurrent access token refresh requests', async () => {
    const userId = 'user-uuid-123';
    const cryptoService = (googleService as unknown as { cryptoService: { encrypt: (s: string) => string } }).cryptoService;
    const mockEncryptedRefreshToken = cryptoService.encrypt('mock-refresh-token');

    mockPrisma.googleConnection.findUnique.mockResolvedValue({
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
    expect(mockPrisma.googleConnection.findUnique).toHaveBeenCalledTimes(1);
  });

  it('should unlink Google account and revoke token', async () => {
    const userId = 'user-uuid-123';
    const cryptoService = (googleService as unknown as { cryptoService: { encrypt: (s: string) => string } }).cryptoService;
    const mockEncryptedRefreshToken = cryptoService.encrypt('mock-refresh-token');

    mockPrisma.googleConnection.findUnique.mockResolvedValue({
      userId,
      encryptedRefreshToken: mockEncryptedRefreshToken,
    });

    await googleService.unlinkGoogleAccount(userId);

    expect(mockPrisma.googleConnection.delete).toHaveBeenCalledWith({
      where: { userId },
    });
  });
});
