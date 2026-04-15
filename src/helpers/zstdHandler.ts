import { NextFunction, Request, Response } from "express";
import { decompress } from "@mongodb-js/zstd";

export const zstdMiddleware = async (req: Request, res: Response, next: NextFunction) => {
  if (req.headers["content-encoding"] === "zstd") {
    const chunks: Buffer[] = [];

    req.on("data", chunk => chunks.push(chunk));
    req.on("end", async () => {
      const buffer = Buffer.concat(chunks);
      req.body = JSON.parse((await decompress(buffer)).toString());
      next();
    });
  } else {
    next();
  }
}