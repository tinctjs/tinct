/**
 * The app's LandmarkProvider: MediaPipe Face Landmarker wrapped in one
 * function. This is the imagepipe seam working as intended — the library
 * ships no model, the app brings whichever one it wants. Swap this file
 * for TensorFlow.js or your own detector and nothing else changes.
 *
 * The wasm runtime and the ~3 MB model download from CDNs on first use.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceLandmarks, LandmarkPoint, LandmarkProvider } from 'imagepipe/track'

const WASM_CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** Mesh index groups for the anchors imagepipe cares about. */
const MESH = {
  eyeA: [33, 133], // one eye's corners in the 468-point mesh
  eyeB: [362, 263], // the other eye's corners
  nose: [1],
  mouth: [13, 14],
}

function meshMean(mesh: { x: number; y: number }[], indices: number[]): LandmarkPoint {
  let x = 0
  let y = 0
  for (const i of indices) {
    x += mesh[i]!.x
    y += mesh[i]!.y
  }
  return [x / indices.length, y / indices.length]
}

/** Map a 468-point mesh onto imagepipe's named anchors. */
export function toFaceLandmarks(mesh: { x: number; y: number }[]): FaceLandmarks {
  const eyeA = meshMean(mesh, MESH.eyeA)
  const eyeB = meshMean(mesh, MESH.eyeB)
  // "left" means viewer-left (smaller x) — this dodges the mesh's own
  // left/right naming and stays correct under mirrored inputs.
  const [leftEye, rightEye] = eyeA[0] <= eyeB[0] ? [eyeA, eyeB] : [eyeB, eyeA]
  let minX = 1
  let minY = 1
  let maxX = 0
  let maxY = 0
  for (const p of mesh) {
    if (p.x < minX) minX = p.x
    if (p.x > maxX) maxX = p.x
    if (p.y < minY) minY = p.y
    if (p.y > maxY) maxY = p.y
  }
  return {
    leftEye,
    rightEye,
    nose: meshMean(mesh, MESH.nose),
    mouth: meshMean(mesh, MESH.mouth),
    box: [minX, minY, maxX - minX, maxY - minY],
  }
}

/**
 * Build the provider. Downloads the runtime + model, then returns a
 * synchronous per-frame detector for the given video element.
 */
export async function createFaceProvider(video: HTMLVideoElement): Promise<LandmarkProvider> {
  const vision = await FilesetResolver.forVisionTasks(WASM_CDN)
  const landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numFaces: 1,
  })
  let lastTimestamp = 0
  return () => {
    // detectForVideo requires strictly increasing timestamps.
    lastTimestamp = Math.max(lastTimestamp + 1, performance.now())
    const result = landmarker.detectForVideo(video, lastTimestamp)
    const mesh = result.faceLandmarks[0]
    return mesh && mesh.length > 0 ? toFaceLandmarks(mesh) : null
  }
}
