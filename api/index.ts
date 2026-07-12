// api/index.ts
//
// Vercel convention: any file under /api at the repo root becomes a
// serverless function. Express apps are themselves valid (req, res)
// handlers, so we can export our existing app directly — no serverless-http
// wrapper needed. In packages/api/src/index.ts, app.listen() is skipped
// when NODE_ENV === "production" (which Vercel sets automatically), so
// importing it here is safe.

import app from "../packages/api/src/index";

export default app;
