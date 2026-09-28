import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { readFileSync } from 'node:fs';
import { vitePluginWs } from './server/vitePluginWs.js';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

export default defineConfig(({ mode }) => ({
  // Tek sürüm kaynağı package.json: ayarların SİSTEM sekmesi buradan okur,
  //arayüze gömülü sabit bir "v1.0" satırı yok.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
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
