import express from 'express';
import healthRouter from './health';
import claudeRouter from './claude';
import openaiRoutes from './codex';
import { zstdMiddleware } from '../helpers/zstdHandler';

const router = express.Router();

// Health Router
router.use('/health', express.json(), healthRouter);

// Handle all api calls coming from claude code
router.use('/claude', express.json(), claudeRouter);

// Handle all api calls coming from codex
router.use('/codex', zstdMiddleware, openaiRoutes);

// Handle all api calls coming from Gemini CLI

// Handle all api calls coming from Grok CLI

export default router;
