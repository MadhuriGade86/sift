import { FormEvent, useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import type { Job } from "@sift/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, Skeleton, EmptyState, ErrorState } from "../components/ui/Feedback";

type LoadState = "loading" | "error" | "success";

export function JobsPage() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const search = searchParams.get("search") ?? "";

  const [jobs, setJobs] = useState<Job[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setState("loading");
    try {
      const query = search ? `?search=${encodeURIComponent(search)}` : "";
      const res = await api.get<{ data: Job[] }>(`/jobs${query}`);
      setJobs(res.data);
      setState("success");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  function handleSearchChange(value: string) {
    // Filters mirrored into the URL query string, per functional spec —
    // shareable/bookmarkable, survives back-button.
    setSearchParams(value ? { search: value } : {});
  }

  const canCreate = user?.role === "recruiter" || user?.role === "admin";

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-ink-900">Jobs</h1>
        {canCreate && <Button onClick={() => setShowCreate((v) => !v)}>New job</Button>}
      </div>

      {showCreate && <CreateJobForm onCreated={() => { setShowCreate(false); load(); }} />}

      <div className="mb-4 max-w-sm">
        <Input
          label="Search jobs"
          placeholder="Search by title…"
          defaultValue={search}
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {state === "loading" && (
        <div className="flex flex-col gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {state === "error" && <ErrorState message="Couldn't load jobs." onRetry={load} />}

      {state === "success" && jobs.length === 0 && (
        <EmptyState
          title={search ? "No jobs match your search" : "No jobs yet"}
          description={
            search
              ? "Try a different search term."
              : "Create your first job to start building a pipeline."
          }
          action={
            search ? (
              <Button variant="secondary" onClick={() => handleSearchChange("")}>
                Clear search
              </Button>
            ) : canCreate ? (
              <Button onClick={() => setShowCreate(true)}>Create your first job</Button>
            ) : undefined
          }
        />
      )}

      {state === "success" && jobs.length > 0 && (
        <div className="flex flex-col gap-3">
          {jobs.map((job) => (
            <Link key={job.id} to={`/jobs/${job.id}`}>
              <Card className="transition-colors duration-micro hover:border-accent">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-ink-900">{job.title}</p>
                    <p className="text-sm text-ink-600">{job.department}</p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const colors = {
    draft: "bg-ink-300/40 text-ink-600",
    open: "bg-success/10 text-success",
    closed: "bg-ink-300/40 text-ink-600",
  };
  return (
    <span className={`rounded-pill px-3 py-1 text-xs font-medium capitalize ${colors[status]}`}>
      {status}
    </span>
  );
}

function CreateJobForm({ onCreated }: { onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/jobs", { title, department });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create job.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Job title" required value={title} onChange={(e) => setTitle(e.target.value)} />
          <Input
            label="Department"
            required
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={submitting} className="self-start">
          Create job
        </Button>
      </form>
    </Card>
  );
}
