import argon2 from 'argon2';
import crypto from 'crypto';
import type { PrismaClient, User } from '@prisma/client';
import { env } from '../config/env.js';
import type { UserDto } from '@cinedrive/shared';

const SESSION_EXPIRATION_DAYS = 7;

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

    if (!user || !user.passwordHash) {
      throw new Error('INVALID_CREDENTIALS');
    }

    const validPassword = await argon2.verify(user.passwordHash, passwordPlain);
    if (!validPassword) {
      throw new Error('INVALID_CREDENTIALS');
    }

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
