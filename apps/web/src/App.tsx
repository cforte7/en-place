import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import type {
  AuthenticatedSessionResponse,
  UserResponse,
} from "@en-place/contracts";

import {
  ApiError,
  clearSessionToken,
  createAccount,
  getCurrentUser,
  getSessionToken,
  login,
  logout,
  saveSessionToken,
} from "./api";

import { RecipeBuilderPage } from "./RecipeBuilder";

const currentUserQueryKey = ["current-user"] as const;

export function App() {
  const queryClient = useQueryClient();
  const [token, setToken] = useState(getSessionToken);
  const currentUser = useQuery({
    queryKey: currentUserQueryKey,
    queryFn: getCurrentUser,
    enabled: token !== null,
    retry: false,
  });
  const signOut = useMutation({
    mutationFn: logout,
    onSettled: () => {
      clearSessionToken();
      setToken(null);
      queryClient.removeQueries({ queryKey: currentUserQueryKey });
    },
  });

  useEffect(() => {
    if (currentUser.error instanceof ApiError && currentUser.error.status === 401) {
      clearSessionToken();
      setToken(null);
      queryClient.removeQueries({ queryKey: currentUserQueryKey });
    }
  }, [currentUser.error, queryClient]);

  function finishAuthentication(session: AuthenticatedSessionResponse) {
    saveSessionToken(session.sessionToken);
    setToken(session.sessionToken);
    queryClient.setQueryData(currentUserQueryKey, session.user);
  }

  if (token && currentUser.isPending) {
    return <LoadingScreen />;
  }

  const user = currentUser.data;
  const restoreError = token && currentUser.error
    ? currentUser.error.message
    : undefined;

  return (
    <Routes>
      <Route
        path="/login"
        element={user
          ? <Navigate to="/" replace />
          : (
            <AuthenticationPage
              onAuthenticated={finishAuthentication}
              restoreError={restoreError}
            />
          )}
      />
      <Route
        path="/"
        element={user
          ? (
            <AppShell
              user={user}
              isSigningOut={signOut.isPending}
              onSignOut={() => signOut.mutate()}
            />
          )
          : <Navigate to="/login" replace />}
      >
        <Route index element={<HomePage user={user} />} />
        <Route path="account" element={<AccountPage user={user} />} />
        <Route path="recipes/new" element={<RecipeBuilderPage />} />
        <Route path="recipes/:recipeId" element={<RecipeBuilderPage />} />
      </Route>
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  );
}

function AuthenticationPage({
  onAuthenticated,
  restoreError,
}: {
  onAuthenticated: (session: AuthenticatedSessionResponse) => void;
  restoreError: string | undefined;
}) {
  const [mode, setMode] = useState<"login" | "create">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const authentication = useMutation({
    mutationFn: () => {
      if (mode === "login") {
        return login({ email, password });
      }

      const name = displayName.trim();
      return createAccount({
        email,
        password,
        ...(name ? { displayName: name } : {}),
      });
    },
    onSuccess: onAuthenticated,
  });

  function selectMode(nextMode: "login" | "create") {
    setMode(nextMode);
    authentication.reset();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    authentication.mutate();
  }

  const error = authentication.error?.message ?? restoreError;
  const title = mode === "login" ? "Welcome back" : "Create your account";

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <header className="auth-heading">
          <p className="eyebrow">En Place</p>
          <h1 id="auth-title">{title}</h1>
          <p>Keep your kitchen organized and ready to cook.</p>
        </header>

        <div className="mode-switch" aria-label="Authentication mode">
          <button
            type="button"
            className={mode === "login" ? "active" : ""}
            aria-pressed={mode === "login"}
            onClick={() => selectMode("login")}
          >
            Sign in
          </button>
          <button
            type="button"
            className={mode === "create" ? "active" : ""}
            aria-pressed={mode === "create"}
            onClick={() => selectMode("create")}
          >
            Create account
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === "create" && (
            <label>
              Display name <span>Optional</span>
              <input
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
                autoComplete="name"
                maxLength={100}
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>

          {error && <p className="form-error" role="alert">{error}</p>}

          <button className="primary-button" type="submit" disabled={authentication.isPending}>
            {authentication.isPending
              ? "Please wait…"
              : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
      </section>
    </main>
  );
}

function AppShell({
  user,
  isSigningOut,
  onSignOut,
}: {
  user: UserResponse;
  isSigningOut: boolean;
  onSignOut: () => void;
}) {
  const location = useLocation();
  const isRecipeBuilder = location.pathname.startsWith("/recipes/");

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink className="brand" to="/">En Place</NavLink>
        <nav aria-label="Main navigation">
          <NavLink to="/" end>Home</NavLink>
          <NavLink to="/account">Account</NavLink>
        </nav>
        <button className="text-button" type="button" onClick={onSignOut} disabled={isSigningOut}>
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </header>
      <main className={isRecipeBuilder ? "page-content recipe-builder-content" : "page-content"}>
        <Outlet />
      </main>
    </div>
  );
}

function HomePage({ user }: { user: UserResponse | undefined }) {
  if (!user) {
    return null;
  }

  return (
    <section className="landing-page">
      <p className="eyebrow">Home</p>
      <h1>Welcome{user.displayName ? `, ${user.displayName}` : ""}.</h1>
      <p className="lead">You are signed in to En Place.</p>
      <Link className="create-recipe-button" to="/recipes/new">
        <span aria-hidden="true">+</span>
        Add a recipe
      </Link>
      <div className="status-card">
        <span className="status-dot" aria-hidden="true" />
        <div>
          <strong>Current session</strong>
          <p>{user.email}</p>
        </div>
      </div>
    </section>
  );
}

function AccountPage({ user }: { user: UserResponse | undefined }) {
  if (!user) {
    return null;
  }

  return (
    <section>
      <p className="eyebrow">Account</p>
      <h1>Your profile</h1>
      <dl className="profile-card">
        <ProfileRow label="Display name" value={user.displayName ?? "Not set"} />
        <ProfileRow label="Email" value={user.email} />
        <ProfileRow
          label="Email verification"
          value={user.emailVerifiedAt ? formatDate(user.emailVerifiedAt) : "Not verified"}
        />
        <ProfileRow label="Member since" value={formatDate(user.createdAt)} />
      </dl>
    </section>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function LoadingScreen() {
  return (
    <main className="loading-screen">
      <div className="spinner" aria-hidden="true" />
      <p>Restoring your session…</p>
    </main>
  );
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}
