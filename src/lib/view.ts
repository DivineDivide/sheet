import { bounds, type Box } from './layout';

/**
 * Where the canvas is looking: the sheet point at the middle of the screen, and the zoom.
 * Screen points here are measured from the middle too, so the window's size never enters.
 */
export type View = { x: number; y: number; z: number };

export const HOME: View = { x: 0, y: 0, z: 1 };
export const ZOOM = { min: 0.25, max: 3 };

const clampZoom = (z: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, z));

export const toSheet = (v: View, sx: number, sy: number) => ({
	x: v.x + sx / v.z,
	y: v.y + sy / v.z
});

/** Zooms to `z`, keeping the sheet point under (sx, sy) where it is on screen. */
export function zoomAt(v: View, z: number, sx = 0, sy = 0): View {
	const nz = clampZoom(z);
	const p = toSheet(v, sx, sy);
	return { x: p.x - sx / nz, y: p.y - sy / nz, z: nz };
}

/** Every box in sight with a margin, never past 100%: fitting is not for magnifying. */
export function fit(boxes: Box[], w: number, h: number, margin = 48): View {
	if (!boxes.length) return HOME;
	const b = bounds(boxes);
	const z = clampZoom(Math.min((w - 2 * margin) / b.w, (h - 2 * margin) / b.h, 1));
	return { x: b.x + b.w / 2, y: b.y + b.h / 2, z };
}
