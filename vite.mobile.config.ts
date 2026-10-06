import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/postcss';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'mobile',
  envDir: path.resolve(__dirname),
  base: './',
  css: { postcss: { plugins: [tailwindcss()] } },
  plugins: [react(),{
    name:'public-release-credential-guard',
    generateBundle(_options,bundle){
      if(process.env.GITHUB_ACTIONS!=='true')return;
      for(const [name,file] of Object.entries(bundle)){
        const source=file.type==='chunk'?file.code:typeof file.source==='string'?file.source:'';
        if(/(?<![A-Za-z0-9_-])(?:sk-[A-Za-z0-9_-]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[opusr]_[A-Za-z0-9]{30,})/.test(source))throw new Error(`公开构建发现疑似密钥，已停止发布：${name}`);
      }
    },
  }],
  resolve: { alias: { '@': path.resolve(__dirname) } },
  build: {
    outDir: '../mobile-dist',
    emptyOutDir: true,
    target: 'es2022',
  },
});
