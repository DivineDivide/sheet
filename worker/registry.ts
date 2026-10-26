import { DurableObject } from 'cloudflare:workers';
import type { RoomInfo } from '../src/lib/rooms';

/** Every room a GM made, so `/gm` can list them: one object for the whole Worker. */
export class Registry extends DurableObject<Env> {
	private sql: SqlStorage;

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.sql = ctx.storage.sql;
		this.sql.exec(
			'CREATE TABLE IF NOT EXISTS room (token TEXT PRIMARY KEY, name TEXT NOT NULL, creator TEXT NOT NULL, created INTEGER NOT NULL)'
		);
	}

	add(r: RoomInfo) {
		this.sql.exec('INSERT INTO room VALUES (?, ?, ?, ?)', r.token, r.name, r.creator, r.created);
	}

	list(): RoomInfo[] {
		return this.sql
			.exec('SELECT token, name, creator, created FROM room ORDER BY created DESC')
			.toArray()
			.map((r) => ({
				token: String(r.token),
				name: String(r.name),
				creator: String(r.creator),
				created: Number(r.created)
			}));
	}

	remove(token: string) {
		this.sql.exec('DELETE FROM room WHERE token = ?', token);
	}
}
