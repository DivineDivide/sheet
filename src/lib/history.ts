/** Undo and redo over steps, each holding what a change did and what takes it back. */
export class History<T> {
	past: T[] = [];
	future: T[] = [];

	constructor(private limit = 100) {}

	record(step: T) {
		this.past.push(step);
		if (this.past.length > this.limit) this.past.shift();
		this.future = [];
	}

	undo(): T | undefined {
		const step = this.past.pop();
		if (step !== undefined) this.future.push(step);
		return step;
	}

	redo(): T | undefined {
		const step = this.future.pop();
		if (step !== undefined) this.past.push(step);
		return step;
	}
}
