import { FormEvent, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";

export function Signup() {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [organizationName, setOrganizationName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = inviteToken
        ? { mode: "join_org" as const, inviteToken, email, password }
        : { mode: "create_org" as const, organizationName, email, password };
      await api.post("/auth/signup", payload);
      await refresh();
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-100 px-4">
        <div className="w-full max-w-sm rounded-card border border-ink-300 bg-surface p-6 text-center">
          <h1 className="mb-2 text-xl font-semibold text-ink-900">Check your email</h1>
          <p className="mb-4 text-sm text-ink-600">
            We sent a verification link. Click it, then come back and sign in.
          </p>
          <Button onClick={() => navigate("/login")} className="w-full">
            Go to sign in
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-100 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-2xl font-semibold text-ink-900">
          {inviteToken ? "Join your team on Sift" : "Create your organization"}
        </h1>
        <p className="mb-6 text-sm text-ink-600">
          {inviteToken
            ? "You've been invited — set a password to finish joining."
            : "Start tracking candidates in minutes."}
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4 rounded-card border border-ink-300 bg-surface p-6">
          {!inviteToken && (
            <Input
              label="Organization name"
              required
              value={organizationName}
              onChange={(e) => setOrganizationName(e.target.value)}
            />
          )}
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" loading={submitting} className="w-full">
            {submitting ? "Creating account…" : "Create account"}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-600">
          Already have an account?{" "}
          <Link to="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
