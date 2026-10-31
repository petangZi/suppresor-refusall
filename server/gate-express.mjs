// Mount the gate inside the existing Express app. No second process, no local
// daemon: the plugin points at https://host/api/gate.

import express from 'express';
import { handleRequest } from './gate.mjs';

export function createGateMiddleware({ limit = '1mb' } = {}) {
  const router = express.Router();

  router.use(express.json({ limit, strict: true, type: 'application/json' }));

  router.use(async (req, res) => {
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (typeof value === 'string') headers.set(name, value);
      else if (Array.isArray(value)) headers.set(name, value.join(','));
    }
    headers.set('x-gate-ip', req.socket.remoteAddress || 'local');

    const proto = req.protocol || 'http';
    // req.url is relative to the mount path, which is what the gate routes expect.
    const url = `${proto}://${req.get('host') || 'localhost'}${req.url}`;
    const init = { method: req.method, headers };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = JSON.stringify(req.body ?? {});
    }

    try {
      const response = await handleRequest(new Request(url, init));
      res.status(response.status);
      response.headers.forEach((value, name) => {
        if (name.toLowerCase() !== 'transfer-encoding') res.setHeader(name, value);
      });
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.status(500).json({ error: 'internal' });
    }
  });

  router.use((error, _req, res, _next) => {
    if (error && (error.type === 'entity.too.large' || error.status === 413)) {
      return res.status(413).json({ error: 'payload_too_large' });
    }
    return res.status(400).json({ error: 'bad_request' });
  });

  return router;
}

export function mountGate(app, path = '/api/gate', options = {}) {
  app.disable('x-powered-by');
  app.use(path, createGateMiddleware(options));
  return app;
}
