import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    target: "es2022",
    // The test route is the latency-critical path and has its own budget.
    // Anything that would push it past 100 KB gzip belongs behind a dynamic import.
    reportCompressedSize: true,
  },
});
