import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');

    // Robustly check for the API key in various likely environment variables
    const apiKey = env.GEMINI_API_KEY ||
                   env.VITE_GEMINI_API_KEY ||
                   env.API_KEY ||
                   env.VITE_API_KEY ||
                   process.env.GEMINI_API_KEY ||
                   process.env.VITE_GEMINI_API_KEY ||
                   process.env.API_KEY ||
                   process.env.VITE_API_KEY;

    if (!apiKey) {
      console.warn("⚠️  WARNING: No API Key found in environment variables (GEMINI_API_KEY, VITE_GEMINI_API_KEY, API_KEY, etc). AI features will not work.");
    } else {
      console.log(`✅ API Key found (starts with ${apiKey.substring(0, 4)}...)`);
    }

    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(apiKey),
        'process.env.GEMINI_API_KEY': JSON.stringify(apiKey)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
