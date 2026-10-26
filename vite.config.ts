import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ mode }) => ({
	// The Worker runs inside `vite dev`; tests need only the plain modules.
	plugins: [svelte({ compilerOptions: { runes: true } }), mode !== 'test' && cloudflare()],
	server: { port: 7476, strictPort: true }
}));
