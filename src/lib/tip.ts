import type { Attachment } from 'svelte/attachments';

// One hint for the page, in the top layer, so no box's overflow or the sheet's zoom clips it.
let box: HTMLDivElement | undefined;

/** Shows `text` beside the element while the pointer is over it, drawn in the theme. */
export const tip =
	(text: string): Attachment<HTMLElement> =>
	(el) => {
		const show = () => {
			if (!text) return;
			box ??= document.body.appendChild(
				Object.assign(document.createElement('div'), { className: 'tip', popover: 'manual' })
			);
			box.textContent = text;
			box.showPopover();
			const r = el.getBoundingClientRect();
			const fits = r.bottom + 6 + box.offsetHeight < innerHeight;
			box.style.left = `${Math.max(8, Math.min(r.left, innerWidth - box.offsetWidth - 8))}px`;
			box.style.top = `${fits ? r.bottom + 6 : r.top - 6 - box.offsetHeight}px`;
		};
		const hide = () => box?.hidePopover();
		el.addEventListener('pointerenter', show);
		el.addEventListener('pointerleave', hide);
		return () => {
			el.removeEventListener('pointerenter', show);
			el.removeEventListener('pointerleave', hide);
			hide();
		};
	};
