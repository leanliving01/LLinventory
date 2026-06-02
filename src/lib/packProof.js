import { supabase } from '@/api/supabaseClient';

/**
 * Proof-of-pack photo helpers.
 * The packer photographs the sealed, labelled box at Finish. We compress on-device to keep
 * it small (~90–120 KB at 1024px / quality 0.6) and upload to the public 'pack-proofs'
 * bucket, returning the public URL to store against the order/section + completed event.
 */

const BUCKET = 'pack-proofs';

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

/** Resize to maxDim (longest edge) and JPEG-encode at the given quality. */
export async function compressImage(file, maxDim = 1024, quality = 0.6) {
  const img = await loadImage(file);
  const longest = Math.max(img.width, img.height) || 1;
  const scale = Math.min(1, maxDim / longest);
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return blob || file; // fall back to original if toBlob unsupported
}

/**
 * Compress + upload a proof photo. Returns the public URL.
 * @param file    the captured image File/Blob
 * @param orderId sales_order id (folder)
 * @param section 'supplements' | 'meals'
 */
export async function uploadPackProof(file, orderId, section) {
  const blob = await compressImage(file, 1024, 0.6);
  const path = `${orderId}/${section}-${Date.now()}.jpg`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (error) throw new Error(error.message);
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}
