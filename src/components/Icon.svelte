<script lang="ts" module>
	// Strokes on a 24px grid, after Lucide (ISC).
	const paths = {
		number: 'M4 9h16M4 15h16M10 3 8 21M16 3l-2 18',
		resource:
			'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z',
		track: 'M3 9h4v6H3zM10 9h4v6h-4zM17 9h4v6h-4z',
		formula: 'M18 7V4H6l6 8-6 8h12v-3',
		button:
			'M14 4.1 12 6M5.1 8l-2.9-.8M6 12l-1.9 2M7.2 2.2 8 5.1M9.04 9.69a.5.5 0 0 1 .65-.65l11 4.5a.5.5 0 0 1-.07.95l-4.35 1.04a1 1 0 0 0-.74.74l-1.04 4.35a.5.5 0 0 1-.95.07z',
		text: 'M4 6h16M4 12h16M4 18h10',
		choice: 'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM8 10l4 4 4-4',
		tags: 'M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42zM7.5 7.5h.01',
		entries: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
		table:
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM3 9h18M3 15h18M12 3v18',
		image:
			'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM11 9a2 2 0 1 1-4 0 2 2 0 0 1 4 0zM21 15l-3.09-3.09a2 2 0 0 0-2.82 0L6 21',
		field: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
		bind: 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2M8 12h8',
		unbind: 'M9 17H7A5 5 0 0 1 7 7h2M15 7h2a5 5 0 1 1 0 10h-2',
		link: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71',
		template: 'M8 8h12v12H8zM16 8V4H4v12h4',
		plus: 'M12 5v14M5 12h14',
		prev: 'm15 18-6-6 6-6',
		next: 'm9 18 6-6-6-6',
		label: 'M4 7V4h16v3M9 20h6M12 4v16',
		'label-off': 'M4 7V4h16v3M9 20h6M12 4v16M2 2l20 20',
		minus: 'M5 12h14',
		fit: 'M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3',
		home: 'M12 2v4M12 18v4M2 12h4M18 12h4M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
		chat: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'
	};
	export type IconName = keyof typeof paths;
</script>

<script lang="ts">
	let { name }: { name: IconName } = $props();
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"><path d={paths[name]} /></svg
>

<style>
	svg {
		width: 1.1rem;
		height: 1.1rem;
		flex: none;
	}
</style>
