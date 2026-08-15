import { z } from 'zod';

// The other schemas in this file already carry Turkish messages; login was
// left on Zod's English defaults, so the sign-in form answered a Turkish UI
// with "Invalid email".
export const loginSchema = z.object({
  email: z.string().email('Geçerli bir e-posta adresi giriniz.'),
  password: z.string().min(1, 'Parolanızı giriniz.'),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z.string().min(2, 'İsim en az 2 karakter olmalıdır.'),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Mevcut şifrenizi giriniz.'),
  newPassword: z.string().min(6, 'Yeni şifre en az 6 karakter olmalıdır.'),
});

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

export const createUserSchema = z.object({
  email: z.string().trim().email('Geçerli bir e-posta adresi giriniz.'),
  name: z.string().trim().min(2).max(120),
  password: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.'),
  role: z.enum(['admin', 'user']).default('user'),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(['admin', 'user']).optional(),
  disabled: z.boolean().optional(),
});

export const resetUserPasswordSchema = z.object({
  password: z.string().min(8, 'Şifre en az 8 karakter olmalıdır.'),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ResetUserPasswordInput = z.infer<typeof resetUserPasswordSchema>;
