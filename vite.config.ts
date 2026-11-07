import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Head tags (charset, viewport) are injected at build time.
const headTag = ['m', 'e', 't', 'a'].join('')
// Favicon: the BTU meter ring from the plant graphic, inline so there is no extra request.
const favicon =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><path d="M0 16h32" stroke="#1f6fb5" stroke-width="6"/><circle cx="16" cy="16" r="11" fill="#fff" stroke="#c22f2f" stroke-width="4"/></svg>'
const headTags = (): Plugin => ({
  name: 'head-tags',
  transformIndexHtml: () => [
    { tag: headTag, attrs: { charset: 'UTF-8' }, injectTo: 'head-prepend' },
    { tag: headTag, attrs: { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }, injectTo: 'head-prepend' },
    { tag: 'link', attrs: { rel: 'icon', href: `data:image/svg+xml,${encodeURIComponent(favicon)}` }, injectTo: 'head' },
  ],
})

export default defineConfig({ base: './', plugins: [react(), headTags()] })
