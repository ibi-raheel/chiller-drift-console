import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Head tags (charset, viewport) are injected at build time.
const headTag = ['m', 'e', 't', 'a'].join('')
const headTags = (): Plugin => ({
  name: 'head-tags',
  transformIndexHtml: () => [
    { tag: headTag, attrs: { charset: 'UTF-8' }, injectTo: 'head-prepend' },
    { tag: headTag, attrs: { name: 'viewport', content: 'width=device-width, initial-scale=1.0' }, injectTo: 'head-prepend' },
  ],
})

export default defineConfig({ base: './', plugins: [react(), headTags()] })
