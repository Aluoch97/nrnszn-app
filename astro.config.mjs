import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  // Main address once nrnszn.com switches over (same page paths as the Wix site).
  site: 'https://www.nrnszn.com',
  output: 'static',
  // Small stylesheets go inside each page so it can draw without waiting on another file.
  build: { inlineStylesheets: 'always' },
  integrations: [
    sitemap(),
  ],
});
