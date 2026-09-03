import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'mobile',
  base: './',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react()],
  resolve: { alias: { '@': path.resolve(__dirname) } },
  build: {
    outDir: '../mobile-dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
