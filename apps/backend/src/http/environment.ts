import type { UserResponse } from "@en-place/contracts";
import type { RequestIdVariables } from "hono/request-id";

export type AppEnvironment = {
  Variables: RequestIdVariables & {
    authenticatedUser: UserResponse;
    authenticatedSessionId: string;
  };
};
