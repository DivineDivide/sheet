// A minimal headless-Chrome driver over the DevTools protocol, so a UI check needs no browser
// pane and no npm package. The `sheet-room` skill says how to use it.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1400, height = 900 } = {}) {
	const dir = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'cdp-'));
	// Port 0 lets Chrome pick a free one, so sessions checking at once never meet.
	const proc = spawn(
		'nice',
		[
			CHROME,
			'--headless=new',
			'--remote-debugging-port=0',
			`--user-data-dir=${dir}`,
			`--window-size=${width},${height}`,
			'--no-first-run',
			'--no-default-browser-check',
			'about:blank'
		],
		{ stdio: 'ignore' }
	);
	let port;
	let targets = [];
	for (let i = 0; i < 50 && !targets.some((t) => t.type === 'page'); i++) {
		await sleep(200);
		try {
			port ??= readFileSync(join(dir, 'DevToolsActivePort'), 'utf8').split('\n')[0];
			targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
		} catch {}
	}
	const page = targets.find((t) => t.type === 'page');
	if (!page) {
		proc.kill();
		throw new Error('headless Chrome did not start');
	}
	const downloads = join(dir, 'downloads');
	const another = async () => {
		const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' });
		return connect((await res.json()).webSocketDebuggerUrl, downloads);
	};
	return {
		proc,
		downloads,
		another,
		...(await connect(page.webSocketDebuggerUrl, downloads)),
		close: () => proc.kill()
	};
}

async function connect(url, downloads) {
	const ws = new WebSocket(url);
	await new Promise((r, j) => ((ws.onopen = r), (ws.onerror = j)));
	let n = 0;
	const waiting = new Map();
	const logs = [];
	ws.onmessage = (m) => {
		const msg = JSON.parse(m.data);
		if (msg.id && waiting.has(msg.id)) {
			const { r, j } = waiting.get(msg.id);
			waiting.delete(msg.id);
			msg.error ? j(new Error(msg.error.message)) : r(msg.result);
		} else if (msg.method === 'Runtime.consoleAPICalled') {
			const args = msg.params.args.map((a) => a.value ?? a.description);
			logs.push(`${msg.params.type}: ${args.join(' ')}`);
		} else if (msg.method === 'Runtime.exceptionThrown') {
			const d = msg.params.exceptionDetails;
			logs.push(`exception: ${d.exception?.description ?? d.text}`);
		}
	};
	const send = (method, params = {}) =>
		new Promise((r, j) => {
			const id = ++n;
			waiting.set(id, { r, j });
			ws.send(JSON.stringify({ id, method, params }));
		});
	// Into the throwaway profile, never the user's Downloads.
	await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }).catch(
		() => {}
	);
	await send('Runtime.enable');
	await send('Page.enable');
	const evaluate = async (expression) => {
		const res = await send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		});
		if (res.exceptionDetails)
			throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text);
		return res.result.value;
	};
	const goto = async (url) => {
		await send('Page.navigate', { url });
		for (let i = 0; i < 100; i++) {
			await sleep(100);
			if ((await evaluate('document.readyState')) === 'complete') break;
		}
	};
	const shot = async (path) => {
		const { data } = await send('Page.captureScreenshot', { format: 'png' });
		writeFileSync(path, Buffer.from(data, 'base64'));
	};
	const key = async (k, code = k, modifiers = 0) => {
		for (const type of ['keyDown', 'keyUp'])
			await send('Input.dispatchKeyEvent', { type, key: k, code, modifiers });
	};
	const type = (text) => send('Input.insertText', { text });
	const mouse = (type, x, y, modifiers = 0) =>
		send('Input.dispatchMouseEvent', { type, x, y, modifiers, button: 'left', clickCount: 1 });
	const click = async (x, y, modifiers = 0) => {
		await mouse('mousePressed', x, y, modifiers);
		await mouse('mouseReleased', x, y, modifiers);
	};
	const upload = async (selector, files) => {
		const { root } = await send('DOM.getDocument');
		const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
		await send('DOM.setFileInputFiles', { nodeId, files });
	};
	const until = async (expression, ms = 5000) => {
		for (let t = 0; t < ms; t += 100) {
			if (await evaluate(expression)) return true;
			await sleep(100);
		}
		throw new Error(`timed out waiting for ${expression}`);
	};
	return { send, evaluate, goto, shot, key, type, click, mouse, upload, until, logs, sleep };
}
