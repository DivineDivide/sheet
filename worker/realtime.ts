// Cloudflare Realtime's SFU API, called with the app's secret, which never reaches a browser.

// Unordered and never resent: the next position replaces a lost one. Both ends must match it.
const CURSOR = { dataChannelName: 'cursor', ordered: false, maxRetransmits: 0 };

type Sdp = { type: 'offer' | 'answer'; sdp: string };
type Allocated = { id?: number; errorCode?: string; errorDescription?: string };

export function realtime(env: Env) {
	async function call<T>(method: string, path: string, body?: object): Promise<T> {
		const res = await fetch(
			`https://rtc.live.cloudflare.com/v1/apps/${env.CF_REALTIME_ID}/sessions/${path}`,
			{
				method,
				headers: {
					authorization: `Bearer ${env.CF_REALTIME_KEY}`,
					'content-type': 'application/json'
				},
				body: body && JSON.stringify(body)
			}
		);
		const out = await res.json<T & { errorCode?: string; errorDescription?: string }>();
		if (!res.ok || out.errorCode) {
			throw new Error(
				`realtime ${path}: ${out.errorCode ?? res.status} ${out.errorDescription ?? ''}`
			);
		}
		return out;
	}

	/** Channels on `session`, its own cursor or others' to hear, by id in the order asked. */
	async function allocate(session: string, list: object[]): Promise<number[]> {
		const out = await call<{ dataChannels: Allocated[] }>('POST', `${session}/datachannels/new`, {
			dataChannels: list.map((c) => ({ ...c, ...CURSOR }))
		});
		return out.dataChannels.map((c) => {
			if (c.id === undefined || c.errorCode) throw new Error(`realtime channel: ${c.errorCode}`);
			return c.id;
		});
	}

	return {
		/** A new session, and the SFU's offer for its data channel transport. */
		async open(): Promise<{ session: string; offer: Sdp }> {
			const { sessionId } = await call<{ sessionId: string }>('POST', 'new');
			const { sessionDescription } = await call<{ sessionDescription: Sdp }>(
				'POST',
				`${sessionId}/datachannels/establish`,
				{ dataChannel: { location: 'remote', dataChannelName: 'server-events' } }
			);
			return { session: sessionId, offer: sessionDescription };
		},
		answer: (session: string, sdp: string) =>
			call('PUT', `${session}/renegotiate`, { sessionDescription: { type: 'answer', sdp } }),
		publish: async (session: string) => (await allocate(session, [{ location: 'local' }]))[0],
		hear: (session: string, from: string[]) =>
			from.length
				? allocate(
						session,
						from.map((sessionId) => ({ location: 'remote', sessionId }))
					)
				: Promise.resolve([]),
		/** Closes channels; one already gone is no error here. */
		close: (session: string, ids: number[]) =>
			ids.length
				? call('PUT', `${session}/datachannels/close`, {
						dataChannels: ids.map((id) => ({ id }))
					}).catch(() => {})
				: Promise.resolve()
	};
}
