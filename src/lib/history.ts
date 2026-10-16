/** Undo and redo over whole snapshots: the document is small, so no inverses needed. */
export class History<T> {
	past: T[] = [];
	future: T[] = [];

	constructor(private limit = 100) {}

	/** Call with the state as it was just before a change. */
	record(before: T) {
		this.past.push(before);
		if (this.past.length > this.limit) this.past.shift();
		this.future = [];
	}

	undo(current: T): T | undefined {
		const prev = this.past.pop();
		if (prev !== undefined) this.future.push(current);
		return prev;
	}

	redo(current: T): T | undefined {
		const next = this.future.pop();
		if (next !== undefined) this.past.push(current);
		return next;
	}
}
