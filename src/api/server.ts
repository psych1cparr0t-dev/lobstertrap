import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as fs from 'fs';
import agentRoutes from './routes/agents';
import logRoutes from './routes/logs';

const DEFAULT_PORT = 2727;

export function createServer() {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // API routes
  app.use('/api/agents', agentRoutes);
  app.use('/api/logs', logRoutes);

  // Serve dashboard static files if built
  const dashboardDist = path.join(__dirname, '../../dashboard/dist');
  if (fs.existsSync(dashboardDist)) {
    app.use(express.static(dashboardDist));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(dashboardDist, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => {
      res.send(fallbackHtml());
    });
  }

  return app;
}

export function startServer(port: number = DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const app = createServer();
    const server = app.listen(port, () => resolve(port));
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        // Try next port
        startServer(port + 1).then(resolve).catch(reject);
      } else {
        reject(err);
      }
    });
  });
}

// Minimal fallback UI if dashboard isn't built yet
function fallbackHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>LobsterTrap Dashboard</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f0f0f; color: #e0e0e0; padding: 2rem; }
    h1 { color: #ff4d4d; margin-bottom: 0.5rem; }
    .sub { color: #888; margin-bottom: 2rem; font-size: 0.95rem; }
    .card { background: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 12px; padding: 1.5rem; margin-bottom: 1rem; }
    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
    .running { background: #1a3a1a; color: #4ade80; }
    .stopped { background: #3a1a1a; color: #f87171; }
    .unknown { background: #2a2a1a; color: #facc15; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; }
    pre { font-size: 0.8rem; color: #666; margin-top: 0.5rem; }
    .label { font-size: 0.75rem; color: #555; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 0.25rem; }
    .value { font-size: 1rem; font-weight: 500; }
  </style>
</head>
<body>
  <h1>🦞 LobsterTrap</h1>
  <p class="sub">Agent Dashboard — loading...</p>
  <div id="root" class="grid"></div>

  <script>
    async function load() {
      try {
        const res = await fetch('/api/agents');
        const agents = await res.json();
        const root = document.getElementById('root');

        if (!agents.length) {
          root.innerHTML = '<div class="card"><p>No agents found. Run <code>lobstertrap new</code> to create one.</p></div>';
          document.querySelector('.sub').textContent = 'No agents deployed yet.';
          return;
        }

        document.querySelector('.sub').textContent = agents.length + ' agent' + (agents.length !== 1 ? 's' : '') + ' found';

        root.innerHTML = agents.map(a => {
          const status = a.dockerStatus || 'unknown';
          const badge = '<span class="badge ' + status + '">' + status + '</span>';
          return \`<div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem">
              <strong style="font-size:1.1rem">\${a.name}</strong>
              \${badge}
            </div>
            <div class="label">Template</div><div class="value" style="margin-bottom:0.75rem">\${a.template}</div>
            <div class="label">Port</div><div class="value" style="margin-bottom:0.75rem">\${a.port}</div>
            <div class="label">Integrations</div><div class="value">\${(a.integrations || []).join(', ') || 'none'}</div>
            <pre>Created \${new Date(a.createdAt).toLocaleDateString()}</pre>
          </div>\`;
        }).join('');
      } catch (e) {
        document.getElementById('root').innerHTML = '<div class="card"><p style="color:#f87171">Failed to load agents: ' + e.message + '</p></div>';
      }
    }

    load();
    setInterval(load, 5000);
  </script>
</body>
</html>`;
}
