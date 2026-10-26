import { mount } from 'svelte';
import './app.css';
import Gm from './Gm.svelte';
import Home from './Home.svelte';
import Room from './Room.svelte';
import { TOKEN } from './lib/rooms';
import { session } from './lib/session.svelte';

// One app, three pages: a room at /r/<token>, the GMs' rooms at /gm, and / for the rest.
const path = location.pathname;
const [, token] = path.match(/^\/r\/([^/]+)\/?$/) ?? [];
const room = token !== undefined && TOKEN.test(token);
if (room) session.open(token);
mount(room ? Room : /^\/gm\/?$/.test(path) ? Gm : Home, {
	target: document.getElementById('app')!
});
