import type {
  ApiError as ApiErrorResponse,
  AuthenticatedSessionResponse,
  CreateUserRequest,
  LoginRequest,
  RecipeDocument,
  SavedRecipeDocument,
  UserResponse,
} from "@en-place/contracts";

const sessionStorageKey = "en-place.session-token";
const apiBaseUrl = (import.meta.env.VITE_API_URL || "/api").replace(/\/$/, "");

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function getSessionToken() {
  return localStorage.getItem(sessionStorageKey);
}

export function saveSessionToken(token: string) {
  localStorage.setItem(sessionStorageKey, token);
}

export function clearSessionToken() {
  localStorage.removeItem(sessionStorageKey);
}

export function createAccount(input: CreateUserRequest) {
  return request<AuthenticatedSessionResponse>("/users", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function login(input: LoginRequest) {
  return request<AuthenticatedSessionResponse>("/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getCurrentUser() {
  return request<UserResponse>("/users/me", { method: "GET" });
}

export function logout() {
  return request<void>("/auth/session", { method: "DELETE" });
}

export function createRecipe(input: RecipeDocument) {
  return request<SavedRecipeDocument>("/recipes", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function getRecipe(recipeId: string) {
  return request<SavedRecipeDocument>(
    `/recipes/${encodeURIComponent(recipeId)}`,
    { method: "GET" },
  );
}

export function updateRecipe(recipeId: string, input: RecipeDocument) {
  return request<SavedRecipeDocument>(
    `/recipes/${encodeURIComponent(recipeId)}`,
    {
      method: "PUT",
      body: JSON.stringify(input),
    },
  );
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const headers = new Headers(init.headers);
  const token = getSessionToken();

  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${apiBaseUrl}${path}`, { ...init, headers });

  if (!response.ok) {
    const payload = await response
      .json()
      .catch(() => null) as ApiErrorResponse | null;
    throw new ApiError(
      payload?.error.message ?? "The server could not complete the request.",
      response.status,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}
