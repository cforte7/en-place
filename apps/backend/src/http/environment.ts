import type { UserResponse } from "@en-place/contracts";
import type { RequestIdVariables } from "hono/request-id";

import type { UserId } from "../modules/users/user-id";

export type AppEnvironment = {
  Variables: RequestIdVariables & {
    authenticatedUser: UserResponse;
    authenticatedUserId: UserId;
    authenticatedSessionId: string;
  };
};
