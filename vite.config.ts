import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// Emits sw.js with a precache list of every built file, so the web/iOS app works offline.
function serviceWorker(): Plugin {
  let publicDir = ''

  return {
    name: 'delaycam-service-worker',
    apply: 'build',
    configResolved(config) {
      publicDir = config.publicDir
    },
    generateBundle(_options, bundle) {
      const publicFiles = readdirSync(publicDir).filter((file) => !file.startsWith('.'))
      const builtFiles = new Set([...Object.keys(bundle), 'index.html', ...publicFiles])
      const files = ['./', ...[...builtFiles].map((file) => `./${file}`)]
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12)
      const source = readFileSync(new URL('./pwa/sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(files))

      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
})
