import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  // Cast process to any to avoid TypeScript error about missing 'cwd' property on Process type
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  // Safely define process.env.API_KEY.
  // If it exists at build time, use it. 
  // If not, preserve the code 'process.env.API_KEY' so it can be resolved at runtime (e.g. by AI Studio environment).
  // JSON.stringify(undefined) returns undefined, so we fallback to the string literal.
  const apiKeyDefine = JSON.stringify(env.API_KEY || process.env.API_KEY) || 'process.env.API_KEY';

  return {
    plugins: [react()],
    define: {
      // Expose the API_KEY environment variable to the client-side code
      'process.env.API_KEY': apiKeyDefine
    },
    build: {
      chunkSizeWarningLimit: 1600,
    }
  };
});