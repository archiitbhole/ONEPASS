/**
 * The web app manifest, served at `/manifest.webmanifest`.
 *
 * It used to be a static file in `public/`, which meant the product's name,
 * description and colours were written down a second time where a rename would
 * miss them. As a metadata route it reads them from the brand config; every
 * other field is unchanged from the static file it replaces.
 */
import type { MetadataRoute } from 'next';
import { BRAND } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: BRAND.name,
    short_name: BRAND.shortName,
    description: BRAND.description,
    lang: 'en-IN',
    dir: 'ltr',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    theme_color: BRAND.themeColor.light,
    background_color: BRAND.themeColor.light,
    categories: ['lifestyle', 'travel', 'utilities'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512-maskable.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Show my pass',
        short_name: 'Pass',
        url: '/pass',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
      },
      {
        name: 'Tickets',
        short_name: 'Tickets',
        url: '/tickets',
      },
      {
        name: 'Live deals',
        short_name: 'Deals',
        url: '/deals',
      },
    ],
  };
}
