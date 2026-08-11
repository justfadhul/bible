/**
 * Preparing a photo for use as an avatar.
 *
 * Whatever the phone hands over is a multi-megabyte camera JPEG, which is
 * useless to us: it has to fit in localStorage when signed out, and travel
 * over a phone connection when signed in. So every upload is cropped square,
 * scaled to a sensible size and re-encoded before it goes anywhere.
 */

export const AVATAR_PX = 256
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024

/**
 * Reads an image file and returns a square, downscaled JPEG data URI.
 * Crops from the centre, which is where faces are in practice.
 */
export async function fileToAvatarDataUrl(file, size = AVATAR_PX) {
  if (!file) throw new Error('No file chosen.')
  if (!/^image\//.test(file.type)) throw new Error('That is not an image file.')
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('That image is over 12 MB. Try a smaller one.')

  const bitmap = await loadBitmap(file)
  const side = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - side) / 2
  const sy = (bitmap.height - side) / 2

  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, size, size)
  bitmap.close?.()

  // 0.82 keeps a face clean at this size while staying comfortably inside a
  // localStorage budget shared with the reading history.
  return canvas.toDataURL('image/jpeg', 0.82)
}

function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That image could not be read.'))
    }
    img.src = url
  })
}

/** A data URI back to a Blob, for uploading to storage. */
export function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(body)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
