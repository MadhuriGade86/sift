import { Outlet, Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";

export function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-ink-100">
      <header className="flex h-14 items-center justify-between border-b border-ink-300 bg-surface px-6">
        <Link to="/" className="text-lg font-semibold text-ink-900">
          Sift
        </Link>
        <div className="flex items-center gap-4">
{user && !user.emailVerified && (
  <button
    className="rounded-pill bg-accent/10 px-3 py-1 text-sm hover:bg-accent/20"
    onClick={async () => {
      await fetch("/api/auth/resend-verification", { method: "POST", credentials: "include" });
      alert("Verification email sent — check your inbox.");
  }}
>
  Verify your email to unlock full access
</button>
)}
          <Button variant="ghost" onClick={handleLogout}>
            Sign out
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-[1280px] px-6 py-8">
        <Outlet />
      </div>
    </div>
  );
}
