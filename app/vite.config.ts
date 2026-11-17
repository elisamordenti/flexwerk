import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is the GitHub Pages sub-path; overridable with BASE=/ for local preview.
export default defineConfig({
  base: process.env.BASE ?? './',
  plugins: [react()],
  // the simulation worker loads the HiGHS solver lazily, so it needs ES-module output
  worker: { format: 'es' },
});
