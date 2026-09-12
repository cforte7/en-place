import { z } from "zod";

export const serviceHealthSchema = z.object({
  service: z.literal("en-place-backend"),
  status: z.literal("ok"),
});

export type ServiceHealth = z.infer<typeof serviceHealthSchema>;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(320));

export const passwordSchema = z.string().min(1).max(1024);

export const createUserRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    displayName: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;

export const loginRequestSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .strict();

export type LoginRequest = z.infer<typeof loginRequestSchema>;

export const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().nullable(),
  emailVerifiedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export type UserResponse = z.infer<typeof userResponseSchema>;

export const authenticatedSessionResponseSchema = z.object({
  sessionToken: z.string().min(1),
  expiresAt: z.iso.datetime(),
  user: userResponseSchema,
});

export type AuthenticatedSessionResponse = z.infer<
  typeof authenticatedSessionResponseSchema
>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.enum([
      "invalid_request",
      "email_taken",
      "invalid_credentials",
      "unauthorized",
      "not_found",
      "internal_error",
    ]),
    message: z.string(),
  }),
});

export type ApiError = z.infer<typeof apiErrorSchema>;
