import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// ==============================================
// 請在下方引號中貼上您的 Google Gemini API Key
// ==============================================
const HARDCODED_KEY = "AIzaSyCiNjqeW2cYGTE8ViQDcz3_XfQUFJ0EngU"; 

export default defineConfig(({ mode }) => {
  // Cast process to any to avoid TypeScript error about missing 'cwd' property on Process type
  const env = loadEnv(mode, (process as any).cwd(), '');
  
  // 優先使用寫死的 Key，若無則尋找環境變數
  const apiKey = HARDCODED_KEY || env.API_KEY || process.env.API_KEY;
  
  // If API_KEY exists, stringify it for injection. 
  // If NOT, set it to the string "undefined" so the client code `process.env.API_KEY` evaluates to real `undefined`.
  // This prevents the code from becoming the literal string "process.env.API_KEY" which causes crashes in browsers.
  const apiKeyDefine = apiKey ? JSON.stringify(apiKey) : 'undefined';

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