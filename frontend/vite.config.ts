import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __VUE_OPTIONS_API__: 'false',
    __VUE_PROD_DEVTOOLS__: 'false',
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
  },
  optimizeDeps: {
    include: ['@milkdown/crepe', '@milkdown/react', '@milkdown/kit'],
  },
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;

          const normalized = id.replace(/\\/g, '/');
          const [, packagePath = ''] = normalized.split('/node_modules/');
          const parts = packagePath.split('/');
          const packageName = parts[0]?.startsWith('@')
            ? `${parts[0]}/${parts[1] ?? ''}`
            : parts[0];

          if (!packageName) return undefined;
          if (packageName === '@milkdown/crepe' || packageName === '@milkdown/react') {
            return `vendor-milkdown-${packageName.split('/')[1]}`;
          }
          if (packageName.startsWith('@codemirror/')) return `vendor-codemirror-${packageName.split('/')[1]}`;
          if (packageName.startsWith('@lezer/')) return `vendor-lezer-${packageName.split('/')[1]}`;
          if (packageName === 'antd' || packageName.startsWith('@ant-design/')) return 'vendor-antd';
          if (packageName === 'react' || packageName === 'react-dom' || packageName === 'scheduler') return 'vendor-react';
          if (packageName === 'katex') return 'vendor-katex';
          if (packageName === 'codemirror') return 'vendor-codemirror-core';

          return undefined;
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setupTests.ts',
  },
});
