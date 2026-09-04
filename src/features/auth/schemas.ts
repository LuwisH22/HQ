import { z } from 'zod'

/**
 * Auth form schemas.
 *
 * Client-side validation is for fast feedback only. Every rule here also holds
 * in Postgres (CHECK constraints) or in GoTrue (password policy), so bypassing
 * the form gains nothing.
 */

/**
 * Order matters. `.trim()` and `.toLowerCase()` are applied in sequence with
 * the checks that follow them, so normalising first means a pasted address
 * with stray whitespace or capitals is accepted rather than rejected. A
 * trailing `.transform()` would run only *after* validation had already
 * failed.
 */
const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, 'Email is required')
  .email('Enter a valid email address')
  .max(254, 'That email is too long')

/**
 * Length is the rule that actually matters; composition rules push people
 * toward predictable passwords. 10 characters is the floor, matching the
 * Supabase project setting.
 */
const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(72, 'Passwords are limited to 72 characters')

export const signInSchema = z.object({
  email,
  password: z.string().min(1, 'Password is required'),
})
export type SignInValues = z.infer<typeof signInSchema>

export const magicLinkSchema = z.object({ email })
export type MagicLinkValues = z.infer<typeof magicLinkSchema>

export const forgotPasswordSchema = z.object({ email })
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>

export const resetPasswordSchema = z
  .object({
    password,
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  })
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>

export const profileSchema = z.object({
  displayName: z
    .string()
    .trim()
    .min(1, 'Display name is required')
    .max(40, 'Keep it under 40 characters'),
  fullName: z.string().trim().max(80, 'Keep it under 80 characters').or(z.literal('')),
  title: z.string().trim().max(60, 'Keep it under 60 characters').or(z.literal('')),
  bio: z.string().trim().max(500, 'Keep it under 500 characters').or(z.literal('')),
  timezone: z.string().min(1, 'Pick a timezone'),
})
export type ProfileValues = z.infer<typeof profileSchema>

export const inviteSchema = z.object({
  email,
  roleId: z.string().uuid('Pick a role'),
})
export type InviteValues = z.infer<typeof inviteSchema>

export const organizationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(80, 'Keep it under 80 characters'),
  tagline: z.string().trim().max(120, 'Keep it under 120 characters').or(z.literal('')),
  timezone: z.string().min(1, 'Pick a timezone'),
})
export type OrganizationValues = z.infer<typeof organizationSchema>
