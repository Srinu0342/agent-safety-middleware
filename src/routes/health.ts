import { Router, Request, Response } from "express";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  res.json({ status: "ok" });
});

export default router;
