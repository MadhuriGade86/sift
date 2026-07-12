import { FormEvent, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { Application, ApplicationStage, Candidate, Job } from "@sift/shared";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Card, Skeleton, EmptyState, ErrorState } from "../components/ui/Feedback";

const STAGES: { key: ApplicationStage; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "screen", label: "Screen" },
  { key: "interview", label: "Interview" },
  { key: "offer", label: "Offer" },
  { key: "hired", label: "Hired" },
  { key: "rejected", label: "Rejected" },
];

type Row = { application: Application; candidate: Candidate };
type LoadState = "loading" | "error" | "success";

export function PipelinePage() {
  const { jobId } = useParams<{ jobId: string }>();
  const { user } = useAuth();
  const [job, setJob] = useState<Job | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [showAdd, setShowAdd] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  async function load() {
    if (!jobId) return;
    setState("loading");
    try {
      const [jobRes, appsRes] = await Promise.all([
        api.get<Job>(`/jobs/${jobId}`),
        api.get<{ data: Row[] }>(`/applications?jobId=${jobId}&pageSize=100`),
      ]);
      setJob(jobRes);
      setRows(appsRes.data);
      setState("success");
    } catch {
      setState("error");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  async function handleMove(applicationId: string, newStage: ApplicationStage) {
    setMoveError(null);
    const previous = rows;
    // Optimistic UI: update immediately, roll back on failure (functional spec).
    setRows((r) =>
      r.map((row) =>
        row.application.id === applicationId ? { ...row, application: { ...row.application, stage: newStage } } : row
      )
    );
    try {
      await api.patch(`/applications/${applicationId}/stage`, { stage: newStage });
    } catch (err) {
      setRows(previous); // rollback
      setMoveError(err instanceof ApiError ? err.message : "Couldn't move candidate.");
    }
  }

  const canEdit = user?.role === "recruiter" || user?.role === "admin";

  if (state === "loading") {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {STAGES.map((s) => (
          <Skeleton key={s.key} className="h-64 w-full" />
        ))}
      </div>
    );
  }

  if (state === "error") return <ErrorState message="Couldn't load this pipeline." onRetry={load} />;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-ink-900">{job?.title}</h1>
          <p className="text-sm text-ink-600">{job?.department}</p>
        </div>
        {canEdit && <Button onClick={() => setShowAdd((v) => !v)}>Add candidate</Button>}
      </div>

      {showAdd && jobId && (
        <AddCandidateForm jobId={jobId} onAdded={() => { setShowAdd(false); load(); }} />
      )}

      {moveError && (
        <p role="alert" className="mb-4 text-sm text-danger">
          {moveError}
        </p>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No candidates yet"
          description="Add your first candidate to start this pipeline."
          action={canEdit ? <Button onClick={() => setShowAdd(true)}>Add your first candidate</Button> : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 overflow-x-auto sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage) => {
            const stageRows = rows.filter((r) => r.application.stage === stage.key);
            return (
              <div key={stage.key} className="flex flex-col gap-3">
                <h2 className="text-sm font-semibold text-ink-600">
                  {stage.label} <span className="text-ink-300">({stageRows.length})</span>
                </h2>
                {stageRows.map((row) => (
                  <CandidateCard
                    key={row.application.id}
                    row={row}
                    canEdit={canEdit}
                    onMove={(newStage) => handleMove(row.application.id, newStage)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  row,
  canEdit,
  onMove,
}: {
  row: Row;
  canEdit: boolean;
  onMove: (stage: ApplicationStage) => void;
}) {
  return (
    <Card className="p-4">
      <p className="font-medium text-ink-900">{row.candidate.name}</p>
      <p className="mb-3 text-sm text-ink-600">{row.candidate.email}</p>
      {canEdit && (
        <label className="sr-only" htmlFor={`move-${row.application.id}`}>
          Move {row.candidate.name} to stage
        </label>
      )}
      {canEdit && (
        <select
          id={`move-${row.application.id}`}
          value={row.application.stage}
          onChange={(e) => onMove(e.target.value as ApplicationStage)}
          className="w-full rounded-input border border-ink-300 px-2 py-1.5 text-sm min-h-[44px]"
        >
          {STAGES.map((s) => (
            <option key={s.key} value={s.key}>
              Move to {s.label}
            </option>
          ))}
        </select>
      )}
    </Card>
  );
}

function AddCandidateForm({ jobId, onAdded }: { jobId: string; onAdded: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post("/applications", { jobId, candidate: { name, email, source: "other" } });
      onAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't add candidate.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Input label="Candidate name" required value={name} onChange={(e) => setName(e.target.value)} />
          <Input
            label="Candidate email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" loading={submitting} className="self-start">
          Add candidate
        </Button>
      </form>
    </Card>
  );
}
