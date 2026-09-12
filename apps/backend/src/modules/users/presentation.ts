import type { UserResponse } from "@en-place/contracts";

import { users, type User } from "../../database/schema";

export const publicUserColumns = {
  id: users.id,
  email: users.email,
  displayName: users.displayName,
  emailVerifiedAt: users.emailVerifiedAt,
  createdAt: users.createdAt,
  updatedAt: users.updatedAt,
};

type PublicUser = Pick<
  User,
  | "id"
  | "email"
  | "displayName"
  | "emailVerifiedAt"
  | "createdAt"
  | "updatedAt"
>;

export function presentUser(user: PublicUser): UserResponse {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
