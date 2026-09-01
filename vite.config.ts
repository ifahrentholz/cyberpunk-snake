import { defineConfig } from 'vite';

// Base is a relative path, not the repo-name path GitHub Pages projects
// often use (e.g. '/cyberpunk-snake/'). Vite already rewrites the module
// script in index.html to a relative './assets/...' URL at build time, so
// relative asset paths resolve correctly for normal browser navigation to
// this page, regardless of which subpath GitHub Pages serves it from.
// Exception: a client that requests the page without following GitHub's
// redirect to its canonical trailing-slash URL will resolve './assets/...'
// against the wrong parent directory and get a 404 — normal browsers do
// follow that redirect. Hardcoding the repo name here would additionally
// break if the repo is ever renamed or forked, and would force the dev
// server onto a non-root path. Do not "fix" this to the repo path.
export default defineConfig({
  base: './',
});
