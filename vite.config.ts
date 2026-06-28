import { defineConfig, loadEnv } from 'vite';

// Dev only: serve the Vercel-style /api/direct function under `npm run dev`, and load .env into
// process.env so the proxy can read provider keys. In production, api/direct.js is a real Vercel
// Function automatically (this config is ignored there).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['CEREBRAS_API_KEY', 'CEREBRAS_BASE_URL', 'CEREBRAS_MODEL', 'COMPARE_API_KEY', 'COMPARE_BASE_URL', 'COMPARE_MODEL']) {
    if (env[k]) process.env[k] = env[k];
  }
  return {
    plugins: [
      {
        name: 'dev-api',
        configureServer(server) {
          server.middlewares.use('/api/direct', async (req, res) => {
            try {
              const mod = await import('./api/direct.js');
              await mod.default(req, res);
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
          server.middlewares.use('/api/compose', async (req, res) => {
            try {
              const mod = await import('./api/compose.js');
              await mod.default(req, res);
            } catch (e) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: String(e) }));
            }
          });
        },
      },
    ],
  };
});
