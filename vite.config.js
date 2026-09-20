import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { vitePluginWs } from './server/vitePluginWs.js';

export default defineConfig(({ mode }) => ({
  plugins: [
    vitePluginWs(),
    ...(mode === 'https' ? [basicSsl()] : []),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
  },
  build: {
    rollupOptions: {
      // Vendor ayrımı: önbellek isabeti + paralel indirme (uyarı eşiği altı için değil,
      // TTI/LCP için — supabase/qrcode ana oyun kodundan ayrı hash'lenir)
      output: {
        manualChunks: {
          'vendor-supabase': ['@supabase/supabase-js'],
          'vendor-qr': ['qrcode'],
        },
      },
    },
  },
}));
