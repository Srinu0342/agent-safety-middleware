import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import { logger } from "./helpers";
import routes from "./routes";

process.nextTick(() => {
  // ---------------------------------------------------------------------------
  // Express app
  // ---------------------------------------------------------------------------
  const PORT = Number.parseInt(process.env.PROXY_PORT ?? "50080", 10);

  const app = express();

  // ---------------------------------------------------------------------------
  // Route: raw request inspector  (handy during development)
  // Hit GET /inspect from a browser to see what Claude Code is sending.
  // ---------------------------------------------------------------------------

  app.use(routes);

  app.post("/v1/debug/echo", (req: Request, res: Response) => {
    res.json({
      headers: req.headers,
      query: req.query,
      body: req.body,
    });
  });

  // ---------------------------------------------------------------------------
  // Global error handler
  // ---------------------------------------------------------------------------

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled express error", {
      message: err.message,
      stack: err.stack,
    });
    res.status(500).json({ error: err.message });
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------

  app.listen(PORT, () => {
    logger.info(`Agentic proxy listening at`, {
      port: PORT,
      url: `http://localhost:${PORT}`,
    });
  });
});
