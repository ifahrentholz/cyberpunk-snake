import { defineConfig } from 'vite';

// Base is repository-path-relative so GitHub Pages resolves asset URLs
// correctly once the deployment ticket wires this up.
export default defineConfig({
  base: './',
});
