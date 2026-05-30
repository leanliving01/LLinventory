import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Resolve the build's git commit — Vercel exposes VERCEL_GIT_COMMIT_SHA at build
// time; locally we fall back to the working-tree HEAD so the version badge is
// always accurate.
let commitSha = process.env.VERCEL_GIT_COMMIT_SHA || ''
if (!commitSha) {
  try { commitSha = execSync('git rev-parse HEAD').toString().trim() } catch { commitSha = '' }
}
const shortSha = commitSha ? commitSha.slice(0, 7) : 'dev'
const buildTime = new Date().toISOString()

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const supabaseUrl = env.VITE_SUPABASE_URL

  return {
    plugins: [react()],
    define: {
      __APP_VERSION__: JSON.stringify(shortSha),
      __BUILD_TIME__: JSON.stringify(buildTime),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      // Proxy all Supabase requests through localhost so browser extensions
      // that block *.supabase.co don't interfere with auth or data queries.
      proxy: {
        '/__sb': {
          target: supabaseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/__sb/, ''),
          proxyTimeout: 30000,
          timeout: 30000,
        },
      },
    },
  }
});
