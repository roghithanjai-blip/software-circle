// image.js: shrink a chosen photo in the browser. Big originals are accepted; the stored copy is sharp (1024 px) and small.
export const MAX_SOURCE = 15 * 1024 * 1024;
export async function prepareAvatar(file, { max = 1024, quality = 0.9 } = {}) {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image.');
  if (file.size > MAX_SOURCE) throw new Error('That photo is over 15 MB. Pick a smaller one.');
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });   // respects phone rotation
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  const toBlob = (t, q) => new Promise(r => c.toBlob(r, t, q));
  const webp = await toBlob('image/webp', quality);
  const out = webp && webp.type === 'image/webp' ? webp : await toBlob('image/jpeg', quality);
  if (!out) throw new Error('Could not process that image.');
  return { blob: out, type: out.type, ext: out.type === 'image/webp' ? 'webp' : 'jpg', width: w, height: h };
}
