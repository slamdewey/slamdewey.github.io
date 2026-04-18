import { OpenSimplexNoise, fBm3D } from '../open-simplex-noise';
import { cylindricalSx, cylindricalCx, vec2Normalize } from '../math-utils';
import { NoiseVariables } from '../types';

/**
 * Wind direction at a specific latitude, defining Earth-like atmospheric
 * circulation. Control points are placed at cell centers and boundaries
 * so cosine interpolation produces smooth, band-free transitions.
 */
interface WindPoint {
  lat: number; // 0 = north pole, 1 = south pole
  wx: number; // east–west (positive = eastward)
  wy: number; // north–south (positive = southward)
}

const WIND_PROFILE: WindPoint[] = [
  //          lat    wx    wy
  { lat: 0.0, wx: 0.0, wy: 0.0 }, // North pole — calm
  { lat: 0.08, wx: -0.6, wy: 0.4 }, // Polar easterlies (NH)
  { lat: 0.167, wx: 0.0, wy: 0.15 }, // Polar front — convergence
  { lat: 0.25, wx: 0.8, wy: 0.0 }, // Westerlies peak (NH)
  { lat: 0.333, wx: 0.1, wy: -0.15 }, // Horse latitudes — divergence
  { lat: 0.42, wx: -0.7, wy: 0.5 }, // NE trade winds
  { lat: 0.5, wx: -0.3, wy: 0.0 }, // ITCZ — weak easterly convergence
  { lat: 0.58, wx: -0.7, wy: -0.5 }, // SE trade winds
  { lat: 0.667, wx: 0.1, wy: 0.15 }, // Horse latitudes (SH)
  { lat: 0.75, wx: 0.8, wy: 0.0 }, // Westerlies peak (SH)
  { lat: 0.833, wx: 0.0, wy: -0.15 }, // Polar front (SH)
  { lat: 0.92, wx: -0.6, wy: -0.4 }, // Polar easterlies (SH)
  { lat: 1.0, wx: 0.0, wy: 0.0 }, // South pole — calm
];

/** Cosine interpolation — smooth ease-in/ease-out between a and b. */
function cosInterp(a: number, b: number, t: number): number {
  const t2 = (1 - Math.cos(t * Math.PI)) * 0.5;
  return a + (b - a) * t2;
}

/** Sample the wind profile at any latitude with smooth interpolation. */
function sampleWindProfile(lat: number): [number, number] {
  for (let i = 0; i < WIND_PROFILE.length - 1; i++) {
    const p0 = WIND_PROFILE[i];
    const p1 = WIND_PROFILE[i + 1];
    if (lat <= p1.lat) {
      const t = (lat - p0.lat) / (p1.lat - p0.lat);
      return [cosInterp(p0.wx, p1.wx, t), cosInterp(p0.wy, p1.wy, t)];
    }
  }
  return [0, 0];
}

export function generateWind(width: number, height: number, nv: NoiseVariables): Float32Array {
  const noise = new OpenSimplexNoise((nv.seed ^ 0xfae69060) | 0);
  const wind = new Float32Array(width * height * 2);

  const yScale = (2 * Math.PI) / width;
  const jitterFreq = nv.frequency * 1.5;

  for (let y = 0; y < height; y++) {
    const ny = y * yScale;
    const lat = y / height;
    const [baseWx, baseWy] = sampleWindProfile(lat);

    for (let x = 0; x < width; x++) {
      const sx = cylindricalSx(x, width);
      const cx = cylindricalCx(x, width);

      // Two independent noise fields for X and Y turbulence
      const jitterX = fBm3D(noise, sx, ny, cx, 2, jitterFreq, 0.5, 2) * 0.25;
      const jitterY = fBm3D(noise, sx + 100, ny + 100, cx + 100, 2, jitterFreq, 0.5, 2) * 0.25;

      let wx = baseWx + jitterX;
      let wy = baseWy + jitterY;
      [wx, wy] = vec2Normalize(wx, wy);

      const idx = (y * width + x) * 2;
      wind[idx] = wx;
      wind[idx + 1] = wy;
    }
  }

  return wind;
}
