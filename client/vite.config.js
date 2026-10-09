import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      // Dev-only: forward /api to the Express server so the browser sees one origin.
      proxy: { '/api': env.DEV_API_TARGET || 'http://localhost:5001' },
    },
  };
});
