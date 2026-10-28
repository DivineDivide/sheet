import { DurableObject } from 'cloudflare:workers';
import { CAP, windowStart } from '../src/lib/cursor';

/**
 * Realtime use booked ahead by every room, by day: one object for the whole Worker, since the
 * free allowance is the account's. Cloudflare offers no spending cap, so this is it.
 */
export class Meter extends DurableObject<Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec('CREATE TABLE IF NOT EXISTS day (day TEXT PRIMARY KEY, bytes INTEGER NOT NULL)');
	}

	/** Books `bytes`, or books nothing and says no when they would take the window past CAP. */
	book(bytes: number): boolean {
		const now = Date.now();
		this.sql.exec('DELETE FROM day WHERE day < ?', windowStart(now));
		const used = Number(this.sql.exec('SELECT COALESCE(SUM(bytes), 0) AS n FROM day').one().n);
		if (used + bytes > CAP) return false;
		this.sql.exec(
			'INSERT INTO day VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET bytes = bytes + excluded.bytes',
			new Date(now).toISOString().slice(0, 10),
			Math.ceil(bytes)
		);
		return true;
	}
}
