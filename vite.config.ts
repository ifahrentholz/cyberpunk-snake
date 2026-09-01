import { defineConfig } from 'vite';

// Base is a relative path, not the repo-name path GitHub Pages projects
// often use (e.g. '/cyberpunk-snake/'). Vite already rewrites the module
// script in index.html to a relative './assets/...' URL at build time, so
// relative asset paths resolve correctly under any subpath GitHub Pages
// serves this project from. Hardcoding the repo name here would additionally
// break if the repo is ever renamed or forked, and would force the dev
// server onto a non-root path. Do not "fix" this to the repo path.
export default defineConfig({
  base: './',
});
