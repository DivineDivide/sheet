// A picture is stored in the document as a data URL, and a room keeps each character in
// one row of at most 2MB, so each one is shrunk on the way in.
const LONGEST = 1024;
/** A table's cells share their character's row, so each picture there is a quarter the size. */
export const CELL = 512;

export async function shrink(file: Blob, longest = LONGEST): Promise<string> {
	const bitmap = await createImageBitmap(file);
	const k = Math.min(1, longest / Math.max(bitmap.width, bitmap.height));
	const canvas = document.createElement('canvas');
	canvas.width = Math.round(bitmap.width * k);
	canvas.height = Math.round(bitmap.height * k);
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
	bitmap.close();
	// WebP keeps transparency at a photo's size. Safari cannot write it and hands back a
	// PNG, many times larger, so it gets JPEG instead.
	const webp = canvas.toDataURL('image/webp', 0.85);
	return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}
