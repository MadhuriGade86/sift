// packages/api/src/index.ts
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { attachSession } from "./middleware/auth";
import { authRouter } from "./routes/auth";
import { jobsRouter } from "./routes/jobs";
import { pipelineRouter } from "./routes/pipeline";
import { interviewsRouter } from "./routes/interviews";

const app = express();

app.use(
  cors({
    origin: process.env.APP_URL ?? "http://localhost:5173",
    credentials: true, // required so the browser sends/receives the session cookie cross-origin
  })
);
app.use(express.json());
app.use(cookieParser());
app.use(attachSession); // populates req.sessionUser on every request, if a valid session cookie is present

app.get("/api/health", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api", pipelineRouter); // exposes /api/applications
app.use("/api/interviews", interviewsRouter);

// 404 handler — per functional spec, every route path resolves to something,
// never a silent hang.
app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Central error handler — full details logged server-side, generic message
// to the client (functional spec: "friendly message client-side, full
// stack trace logged server-side").
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});

const PORT = process.env.PORT ?? 3001;

// Only listen on a port for local dev — on Vercel, the serverless wrapper
// (api/index.js at the repo root, added at deploy time) imports this `app`
// directly instead of calling `.listen()`.
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
    console.log(`Sift API listening on http://localhost:${PORT}`);
  });
}

export default app;
