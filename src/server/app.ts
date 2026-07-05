import { Hono } from "hono";
import { cors } from "hono/cors";
import { memosRoute } from "./routes/memos";
import { labelsRoute } from "./routes/labels";
import { importExportRoute } from "./routes/import-export";

const app = new Hono();

app.use("*", cors());

app.route("/api/memos", memosRoute);
app.route("/api/labels", labelsRoute);
app.route("/api", importExportRoute);

app.get("/api/health", (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;
