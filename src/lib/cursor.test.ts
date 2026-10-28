import { describe, expect, it } from 'vitest';
import {
	CAP,
	Gauge,
	LIMIT_RATE,
	PERIOD,
	decode,
	encode,
	listenBytes,
	rtcIn,
	seatBytes,
	windowStart
} from './cursor';

describe('encode and decode', () => {
	it('carry a point and its sequence number', () => {
		expect(decode(encode(7, { x: -120.5, y: 48 }))).toEqual({ seq: 7, at: { x: -120.5, y: 48 } });
	});

	it('carry the pointer leaving the sheet', () => {
		expect(decode(encode(8, null))).toEqual({ seq: 8, at: null });
	});

	it('refuse anything else', () => {
		expect(decode('12,4')).toBeNull();
		expect(decode(new ArrayBuffer(13))).toBeNull();
	});
});

it('Gauge allows LIMIT_RATE a second over two seconds, and starts again after', () => {
	const g = new Gauge();
	for (let i = 0; i < 2 * LIMIT_RATE; i++) expect(g.ok(i)).toBe(true);
	expect(g.ok(1999)).toBe(false);
	expect(g.ok(2000)).toBe(true);
});

describe('what a period may cost', () => {
	it('grows by one listener for each person heard', () => {
		expect(seatBytes(3) - seatBytes(2)).toBe(listenBytes);
	});

	it('fits 200 full four-hour tables of eight in the cap', () => {
		// Each hears the other seven at the full rate the whole time, which no table does.
		const periods = (4 * 3_600_000) / PERIOD;
		expect(200 * 8 * seatBytes(7) * periods).toBeLessThan(CAP);
	});
});

it('windowStart is the first of 31 days ending today, in UTC', () => {
	expect(windowStart(Date.UTC(2026, 9, 31, 23, 59))).toBe('2026-10-01');
	expect(windowStart(Date.UTC(2026, 2, 1))).toBe('2026-01-30');
});

describe('rtcIn', () => {
	it('takes the requests a browser makes', () => {
		expect(rtcIn({ rtc: { k: 'start', extra: 1 } })).toEqual({ k: 'start' });
		expect(rtcIn({ rtc: { k: 'answer', sdp: 'v=0' } })).toEqual({ k: 'answer', sdp: 'v=0' });
		expect(rtcIn({ rtc: { k: 'drop', who: 'w1' } })).toEqual({ k: 'drop', who: 'w1' });
	});

	it('is null for anything else', () => {
		expect(rtcIn({ rtc: { k: 'answer' } })).toBeNull();
		expect(rtcIn({ rtc: { k: 'answer', sdp: 'x'.repeat(20_001) } })).toBeNull();
		expect(rtcIn({ rtc: { k: 'open' } })).toBeNull();
		expect(rtcIn({ presence: {} })).toBeNull();
	});
});
