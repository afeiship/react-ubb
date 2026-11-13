import { defineConfig } from 'vite';
import sdf from '@jswork/simple-date-format';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  base: '',
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  define: {
    BUILD_TIME: JSON.stringify(sdf('datetime')),
  },
});
