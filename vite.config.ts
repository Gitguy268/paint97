import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'

// ---------------------------------------------------------------------------
// Security headers
//
// The build is a purely static bundle, so HTML itself cannot enforce
// X-Frame-Options / frame-ancestors / Referrer-Policy: those MUST come from
// whatever serves the files. This config covers the two servers this project
// actually runs (vite dev + vite preview) and additionally injects the CSP as
// a <meta> tag at build time, so a plain static host still gets a policy
// (everything except frame-ancestors, which browsers ignore in meta).
// A production host should send the same directives as headers — see README.
//
// Directive notes:
//  - script-src allows only 'self' plus the *version-pinned* Clippy fallback
//    package (src/lib/clippyChoppy.ts); unpinned or inline script is refused.
//    'wasm-unsafe-eval' lets the browser compile WebAssembly — required by
//    the Ask Clippy runtime (vendored wllama) and the PC Emulator (v86);
//    it does NOT permit regular inline or remote script execution.
//  - connect-src 'self' plus the two places the Ask Clippy model comes
//    from (src/lib/localAi/runtime.ts): huggingface.co for the weights and
//    *.hf.co for the region-dependent CDN its downloads redirect to.
//    Every other third-party fetch stays blocked (defense in depth: the
//    dependency's #addLibrary=/ ?addLibrary= URL-token import is inert
//    in this app — 0 call sites — but this keeps it that way if a future
//    version wires it up). Dev additionally allows the HMR websocket.
//  - style-src needs 'unsafe-inline': React/Excalidraw set element style
//    attributes. script-src deliberately does NOT get 'unsafe-inline'.
//  - dev additionally allows the inline Vite/React Refresh preamble script
//    and the HMR websocket (localhost-only dev server).
//  - frame-src 'self' is for JS Paint (public/jspaint, an <iframe> on our own
//    origin). Paths under /jspaint/ get FRAMED below instead: they may be
//    framed by this origin only, may frame nothing but this origin, and may
//    connect to nothing but this origin. data: and blob: are there because JS
//    Paint reads its autosaved picture and opened files back with fetch().
// ---------------------------------------------------------------------------
const CSP_DIRECTIVES = (scriptSrc: string, connectSrc: string) =>
  [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    // Fonts are self-hosted (public/fonts via scripts/copy-fonts.mjs), so no third-party origin is needed.
    "font-src 'self' data:",
    "media-src 'self' data: blob:",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    // https: only — keeps Excalidraw's embeddable players working while
    // refusing http:, data: and file: frames.
    "frame-src 'self' https:",
  ].join('; ')

const CSP_PROD = CSP_DIRECTIVES(
  "'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net/npm/clippyjs@0.1.0/",
  "'self' https://huggingface.co https://*.hf.co",
)
const CSP_DEV = CSP_DIRECTIVES(
  "'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "'self' https://huggingface.co https://*.hf.co ws://localhost:7891 ws://127.0.0.1:7891",
)

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'camera=(self)', // Send to a device scans the other device's code; /jspaint/ keeps camera=()
  'display-capture=()',
  'encrypted-media=()',
  'geolocation=()',
  'gyroscope=()',
  'magnetometer=()',
  'microphone=()',
  'payment=()',
  'usb=()',
  'serial=()',
  'bluetooth=()',
  'hid=()',
  'idle-detection=()',
  'window-management=()',
].join(', ')

/** JS Paint is same-origin, so it would inherit the camera; it gets none. */
const FRAMED_PERMISSIONS = PERMISSIONS_POLICY.replace('camera=(self)', 'camera=()')

const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': PERMISSIONS_POLICY,
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

const withCsp = (csp: string) => ({ ...baseHeaders, 'Content-Security-Policy': csp })

/** The policy for /jspaint/ — scripts/check-csp-sync.mjs derives vercel.json's copy the same way. */
const FRAMED = (csp: string) =>
  csp
    .replace("frame-ancestors 'none'", "frame-ancestors 'self'")
    .replace("frame-src 'self' https:", "frame-src 'self'")
    .replace(/connect-src [^;]*/, "connect-src 'self' data: blob:")

const setHeaders = (req: { url?: string }, res: { setHeader(k: string, v: string): void }, csp: string) => {
  const framed = req.url?.startsWith('/jspaint/')
  for (const [k, v] of Object.entries(withCsp(framed ? FRAMED(csp) : csp))) res.setHeader(k, v)
  if (framed) {
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    res.setHeader('Permissions-Policy', FRAMED_PERMISSIONS)
  }
}

/**
 * Dev gets the dev policy (inline React-Refresh preamble + HMR websocket on a
 * localhost-only server); preview serves the production policy.
 */
function securityHeaders(): Plugin {
  return {
    name: 'paint97:security-headers',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        setHeaders(req, res, CSP_DEV)
        next()
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        setHeaders(req, res, CSP_PROD)
        next()
      })
    },
  }
}

/**
 * Excalidraw falls back to https://esm.sh for fonts when the local copy is not found, and
 * registers that URL in every @font-face — which a font-src 'self' CSP reports as 99+ violations.
 * Fonts are self-hosted (public/fonts), so point the fallback at our own origin instead.
 */
const ESM_SH_FALLBACK = '`https://esm.sh/'
export function patchExcalidrawFallback(code: string): string {
  const start = code.indexOf(ESM_SH_FALLBACK)
  if (start < 0) return code
  const tail = '/dist/prod/`'
  const end = code.indexOf(tail, start)
  return end < 0 ? code : code.slice(0, start) + '`${globalThis.location.origin}/`' + code.slice(end + tail.length)
}
function selfHostExcalidrawFonts(): Plugin {
  return {
    name: 'paint97:self-host-excalidraw-fonts',
    enforce: 'pre',
    transform(code, id) {
      return /@excalidraw\/excalidraw\/dist\/.*\.js/.test(id) && code.includes('esm.sh') ? { code: patchExcalidrawFallback(code), map: null } : null
    },
  }
}

/** Build-time CSP <meta> so static deployments get a policy without a server. */
function cspMeta(): Plugin {
  return {
    name: 'paint97:csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      // frame-ancestors is only honoured in an HTTP header; browsers log an
      // informational warning if it appears in a <meta>, so inject the rest.
      const metaCsp = CSP_PROD.replace("frame-ancestors 'none'; ", '')
      return html.replace(
        '</head>',
        `  <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />\n  </head>`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(() => {
  // Full env (empty prefix): .env files + process.env, for build-time values.
  return {
    // NOTE: vercel.json duplicates the production policy as HTTP headers —
    // `npm run check:csp` (CI) fails if the two ever drift apart.
    plugins: [react(), selfHostExcalidrawFonts(), securityHeaders(), cspMeta()],
    server: {
      port: 7891,
      host: 'localhost',
      strictPort: true,
    },
    preview: {
      port: 7891,
      host: 'localhost',
    },
    // 98.css ships `@media (not(hover))`, which lightningcss rejects — esbuild tolerates it
    optimizeDeps: {
      // Dev pre-bundles dependencies, bypassing the plugin above: patch inside the optimizer too.
      rolldownOptions: {
        plugins: [{ name: 'paint97:excalidraw-fallback', transform: (code: string, id: string) => (id.includes('@excalidraw/excalidraw/dist') && code.includes('esm.sh') ? { code: patchExcalidrawFallback(code) } : null) }],
      },
    },
    build: {
      cssMinify: 'esbuild' as const,
    },
  }
})
