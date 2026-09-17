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
    port: 5173,
    allowedHosts: ['.loca.lt'],
  },
}));
