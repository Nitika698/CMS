import { Router } from 'express';
import { getDbState } from '../../config/db.js';
import { env } from '../../config/env.js';

const router = Router();

// Liveness: is the process up? Does not depend on the database.
router.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'creatordesk-api',
    environment: env.NODE_ENV,
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

// Readiness: can we serve real requests? 503 when the database is not connected.
router.get('/ready', (_req, res) => {
  const database = getDbState();
  const ready = database === 'connected';
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'degraded',
    database,
    timestamp: new Date().toISOString(),
  });
});

export default router;
