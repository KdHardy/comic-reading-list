import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Stuart's Edge Function logic (../supabase/functions) is plain TypeScript,
  // so its tests run in this suite too.
  server: { fs: { allow: ['..'] } },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', '../supabase/functions/**/*.test.ts'],
  },
});
