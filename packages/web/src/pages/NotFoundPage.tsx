import { Link } from "react-router-dom";
import { Button } from "../components/ui/Button";

export function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-100 px-4 text-center">
      <p className="text-3xl font-semibold text-ink-900">404</p>
      <p className="text-ink-600">This page doesn't exist.</p>
      <Link to="/">
        <Button>Back to Sift</Button>
      </Link>
    </div>
  );
}
