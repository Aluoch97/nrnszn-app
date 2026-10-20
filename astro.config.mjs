import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://app.nrnszn.com',
  output: 'static',
  integrations: [
    sitemap({ filter: (page) => page !== 'https://app.nrnszn.com/' }),
  ],
});
