import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // Dos páginas: la presentación en / y el editor en /app/
  build: { rollupOptions: { input: { landing: 'index.html', app: 'app/index.html' } } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
