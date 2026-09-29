import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [tailwindcss(), react()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Découpe les bibliothèques en chunks séparés : le navigateur les met en
      // cache indépendamment du code de l'application, donc une mise à jour de
      // l'app ne refait plus télécharger ~4 Mo — seulement le chunk applicatif.
      rollupOptions: {
        output: {
          manualChunks: {
            'vendor-react':    ['react', 'react-dom', 'react-router-dom'],
            'vendor-charts':   ['recharts'],
            'vendor-motion':   ['motion'],
            'vendor-i18n':     ['i18next', 'react-i18next', 'i18next-browser-languagedetector'],
            'vendor-icons':    ['lucide-react'],
          },
        },
      },
      chunkSizeWarningLimit: 1500,
    },
  };
});