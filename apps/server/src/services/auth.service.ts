import argon2 from 'argon2';
import crypto from 'crypto';
import type { PrismaClient, User } from '@prisma/client';
import { env } from '../config/env.js';
import type { UserDto } from '@cinedrive/shared';

const SESSION_EXPIRATION_DAYS = 7;

// Pre-computed dummy Argon2id hash to prevent timing attacks / email enumeration
const DUMMY_ARGON2_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RkJBN20vVk1TQUF5cE9IQ29QZFdFZz09';

export class AuthService {
  constructor(private prisma: PrismaClient) {}

  public async ensureAdminUserExists(): Promise<User> {
    const existingAdmin = await this.prisma.user.findUnique({
      where: { email: env.ADMIN_EMAIL },
    });

    if (existingAdmin) {
      return existingAdmin;
    }

    const passwordHash = await argon2.hash(env.ADMIN_PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 65536, // 64 MB
      timeCost: 3,
      parallelism: 4,
    });

    const admin = await this.prisma.user.create({
      data: {
        email: env.ADMIN_EMAIL,
        name: 'Administrator',
        passwordHash,
        role: 'admin',
      },
    });

    return admin;
  }

  public async login(
    email: string,
    passwordPlain: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ user: UserDto; sessionToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Timing attack mitigation: always execute argon2.verify even if user does not exist
    const targetHash = user?.passwordHash || DUMMY_ARGON2_HASH;
    const validPassword = await argon2.verify(targetHash, passwordPlain);

    if (!user || !user.passwordHash || !validPassword) {
      throw new Error('INVALID_CREDENTIALS');
    }

    // Clean up any old expired sessions for this user
    await this.prisma.session.deleteMany({
      where: {
        userId: user.id,
        expiresAt: { lt: new Date() },
      },
    });

    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId: user.id,
        token: sessionToken,
        expiresAt,
        ipAddress,
        userAgent,
      },
    });

    return {
      user: this.toUserDto(user),
      sessionToken,
    };
  }

  public async logout(sessionToken: string): Promise<void> {
    if (!sessionToken) return;
    await this.prisma.session.deleteMany({
      where: { token: sessionToken },
    });
  }

  public async getSessionUser(sessionToken: string): Promise<UserDto | null> {
    if (!sessionToken) return null;

    const session = await this.prisma.session.findUnique({
      where: { token: sessionToken },
      include: { user: true },
    });

    if (!session) return null;

    if (session.expiresAt < new Date()) {
      await this.prisma.session.delete({ where: { id: session.id } });
      return null;
    }

    return this.toUserDto(session.user);
  }

  public async updateProfile(userId: string, name: string): Promise<UserDto> {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { name },
    });
    return this.toUserDto(updated);
  }

  public async changePassword(
    userId: string,
    currentPasswordPlain: string,
    newPasswordPlain: string,
  ): Promise<{ user: UserDto; sessionToken: string }> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user || !user.passwordHash) {
      throw new Error('USER_NOT_FOUND');
    }

    const validCurrent = await argon2.verify(user.passwordHash, currentPasswordPlain);
    if (!validCurrent) {
      throw new Error('INVALID_CURRENT_PASSWORD');
    }

    const newPasswordHash = await argon2.hash(newPasswordPlain, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });

    const updatedUser = await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: newPasswordHash },
    });

    // Clear old sessions for security
    await this.prisma.session.deleteMany({
      where: { userId },
    });

    // Create fresh new session
    const sessionToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + SESSION_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

    await this.prisma.session.create({
      data: {
        userId,
        token: sessionToken,
        expiresAt,
      },
    });

    return {
      user: this.toUserDto(updatedUser),
      sessionToken,
    };
  }

  public toUserDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'admin' | 'user',
      createdAt: user.createdAt.toISOString(),
    };
  }
}
