import argon2 from 'argon2';
import crypto from 'crypto';
import type { PrismaClient, User } from '@cinedrive/prisma';
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

    const passwordHash = await this.hashPassword(env.ADMIN_PASSWORD);

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
    if (user.disabledAt) throw new Error('ACCOUNT_DISABLED');
    if (env.NODE_ENV !== 'test' && env.APP_AUTH_MODE === 'single-user' && user.role !== 'admin') {
      throw new Error('MULTI_USER_DISABLED');
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

    if (session.expiresAt < new Date() || session.user.disabledAt) {
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

    const newPasswordHash = await this.hashPassword(newPasswordPlain);

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

  public async hashPassword(passwordPlain: string): Promise<string> {
    return argon2.hash(passwordPlain, {
      type: argon2.argon2id,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
  }

  public async listUsers(): Promise<UserDto[]> {
    const users = await this.prisma.user.findMany({ orderBy: { createdAt: 'asc' } });
    return users.map((user) => this.toUserDto(user));
  }

  public async createUser(input: {
    email: string;
    name: string;
    password: string;
    role: 'admin' | 'user';
  }): Promise<UserDto> {
    const user = await this.prisma.user.create({
      data: {
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await this.hashPassword(input.password),
        role: input.role,
      },
    });
    return this.toUserDto(user);
  }

  public async updateUser(
    actorUserId: string,
    targetUserId: string,
    input: { name?: string; role?: 'admin' | 'user'; disabled?: boolean },
  ): Promise<UserDto> {
    const target = await this.prisma.user.findUnique({ where: { id: targetUserId } });
    if (!target) throw new Error('USER_NOT_FOUND');
    if (actorUserId === targetUserId && (input.disabled === true || input.role === 'user')) {
      throw new Error('CANNOT_RESTRICT_SELF');
    }
    const removesActiveAdmin =
      target.role === 'admin' && !target.disabledAt && (input.role === 'user' || input.disabled === true);
    if (removesActiveAdmin) {
      const activeAdmins = await this.prisma.user.count({
        where: { role: 'admin', disabledAt: null },
      });
      if (activeAdmins <= 1) throw new Error('LAST_ADMIN_REQUIRED');
    }
    const user = await this.prisma.user.update({
      where: { id: targetUserId },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.disabled !== undefined ? { disabledAt: input.disabled ? new Date() : null } : {}),
      },
    });
    if (input.disabled === true) {
      await this.prisma.session.deleteMany({ where: { userId: targetUserId } });
    }
    return this.toUserDto(user);
  }

  public async resetUserPassword(targetUserId: string, password: string): Promise<void> {
    const exists = await this.prisma.user.count({ where: { id: targetUserId } });
    if (!exists) throw new Error('USER_NOT_FOUND');
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: targetUserId },
        data: { passwordHash: await this.hashPassword(password) },
      }),
      this.prisma.session.deleteMany({ where: { userId: targetUserId } }),
    ]);
  }

  public toUserDto(user: User): UserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as 'admin' | 'user',
      createdAt: user.createdAt.toISOString(),
      disabled: Boolean(user.disabledAt),
    };
  }
}
