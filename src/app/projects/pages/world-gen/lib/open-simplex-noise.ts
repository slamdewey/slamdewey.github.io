/**
 * OpenSimplex Noise in TypeScript.
 * Ported from Java implementation by Kurt Spencer (v1.1, October 5, 2014).
 * Supports 2D and 3D evaluation.
 */

const STRETCH_CONSTANT_2D = -0.211324865405187; // (1/sqrt(2+1)-1)/2
const SQUISH_CONSTANT_2D = 0.366025403784439; // (sqrt(2+1)-1)/2
const STRETCH_CONSTANT_3D = -1.0 / 6; // (1/sqrt(3+1)-1)/3
const SQUISH_CONSTANT_3D = 1.0 / 3; // (sqrt(3+1)-1)/3

const NORM_CONSTANT_2D = 47;
const NORM_CONSTANT_3D = 103;

const GRADIENTS_2D = new Int8Array([5, 2, 2, 5, -5, 2, -2, 5, 5, -2, 2, -5, -5, -2, -2, -5]);

const GRADIENTS_3D = new Int8Array([
  -11, 4, 4, -4, 11, 4, -4, 4, 11, 11, 4, 4, 4, 11, 4, 4, 4, 11, -11, -4, 4, -4, -11, 4, -4, -4, 11, 11, -4, 4, 4, -11,
  4, 4, -4, 11, -11, 4, -4, -4, 11, -4, -4, 4, -11, 11, 4, -4, 4, 11, -4, 4, 4, -11, -11, -4, -4, -4, -11, -4, -4, -4,
  -11, 11, -4, -4, 4, -11, -4, 4, -4, -11,
]);

function fastFloor(x: number): number {
  const xi = Math.trunc(x);
  return x < xi ? xi - 1 : xi;
}

export class OpenSimplexNoise {
  private perm: Int16Array;
  private permGradIndex3D: Int16Array;

  constructor(seed = 0) {
    this.perm = new Int16Array(256);
    this.permGradIndex3D = new Int16Array(256);
    const source = new Int16Array(256);
    for (let i = 0; i < 256; i++) source[i] = i;

    // Use BigInt for the 64-bit LCG to match C# behavior exactly
    let s = BigInt(seed);
    const MUL = 6364136223846793005n;
    const INC = 1442695040888963407n;
    const MASK = (1n << 64n) - 1n;

    s = (s * MUL + INC) & MASK;
    s = (s * MUL + INC) & MASK;
    s = (s * MUL + INC) & MASK;

    for (let i = 255; i >= 0; i--) {
      s = (s * MUL + INC) & MASK;
      // Convert to signed 64-bit for the modulo operation
      let signed = s;
      if (signed >= 1n << 63n) signed -= 1n << 64n;
      let r = Number((signed + 31n) % BigInt(i + 1));
      if (r < 0) r += i + 1;
      this.perm[i] = source[r];
      this.permGradIndex3D[i] = (this.perm[i] % (GRADIENTS_3D.length / 3)) * 3;
      source[r] = source[i];
    }
  }

  eval2D(x: number, y: number): number {
    const stretchOffset = (x + y) * STRETCH_CONSTANT_2D;
    const xs = x + stretchOffset;
    const ys = y + stretchOffset;

    let xsb = fastFloor(xs);
    let ysb = fastFloor(ys);

    const squishOffset = (xsb + ysb) * SQUISH_CONSTANT_2D;
    const xb = xsb + squishOffset;
    const yb = ysb + squishOffset;

    const xins = xs - xsb;
    const yins = ys - ysb;

    const inSum = xins + yins;

    let dx0 = x - xb;
    let dy0 = y - yb;

    let dx_ext: number, dy_ext: number;
    let xsv_ext: number, ysv_ext: number;

    let value = 0;

    // Contribution (1,0)
    const dx1 = dx0 - 1 - SQUISH_CONSTANT_2D;
    const dy1 = dy0 - 0 - SQUISH_CONSTANT_2D;
    let attn1 = 2 - dx1 * dx1 - dy1 * dy1;
    if (attn1 > 0) {
      attn1 *= attn1;
      value += attn1 * attn1 * this.extrapolate2D(xsb + 1, ysb + 0, dx1, dy1);
    }

    // Contribution (0,1)
    const dx2 = dx0 - 0 - SQUISH_CONSTANT_2D;
    const dy2 = dy0 - 1 - SQUISH_CONSTANT_2D;
    let attn2 = 2 - dx2 * dx2 - dy2 * dy2;
    if (attn2 > 0) {
      attn2 *= attn2;
      value += attn2 * attn2 * this.extrapolate2D(xsb + 0, ysb + 1, dx2, dy2);
    }

    if (inSum <= 1) {
      const zins = 1 - inSum;
      if (zins > xins || zins > yins) {
        if (xins > yins) {
          xsv_ext = xsb + 1;
          ysv_ext = ysb - 1;
          dx_ext = dx0 - 1;
          dy_ext = dy0 + 1;
        } else {
          xsv_ext = xsb - 1;
          ysv_ext = ysb + 1;
          dx_ext = dx0 + 1;
          dy_ext = dy0 - 1;
        }
      } else {
        xsv_ext = xsb + 1;
        ysv_ext = ysb + 1;
        dx_ext = dx0 - 1 - 2 * SQUISH_CONSTANT_2D;
        dy_ext = dy0 - 1 - 2 * SQUISH_CONSTANT_2D;
      }
    } else {
      const zins = 2 - inSum;
      if (zins < xins || zins < yins) {
        if (xins > yins) {
          xsv_ext = xsb + 2;
          ysv_ext = ysb + 0;
          dx_ext = dx0 - 2 - 2 * SQUISH_CONSTANT_2D;
          dy_ext = dy0 + 0 - 2 * SQUISH_CONSTANT_2D;
        } else {
          xsv_ext = xsb + 0;
          ysv_ext = ysb + 2;
          dx_ext = dx0 + 0 - 2 * SQUISH_CONSTANT_2D;
          dy_ext = dy0 - 2 - 2 * SQUISH_CONSTANT_2D;
        }
      } else {
        dx_ext = dx0;
        dy_ext = dy0;
        xsv_ext = xsb;
        ysv_ext = ysb;
      }
      xsb += 1;
      ysb += 1;
      dx0 = dx0 - 1 - 2 * SQUISH_CONSTANT_2D;
      dy0 = dy0 - 1 - 2 * SQUISH_CONSTANT_2D;
    }

    // Contribution (0,0) or (1,1)
    let attn0 = 2 - dx0 * dx0 - dy0 * dy0;
    if (attn0 > 0) {
      attn0 *= attn0;
      value += attn0 * attn0 * this.extrapolate2D(xsb, ysb, dx0, dy0);
    }

    // Extra Vertex
    let attn_ext = 2 - dx_ext! * dx_ext! - dy_ext! * dy_ext!;
    if (attn_ext > 0) {
      attn_ext *= attn_ext;
      value += attn_ext * attn_ext * this.extrapolate2D(xsv_ext!, ysv_ext!, dx_ext!, dy_ext!);
    }

    return value / NORM_CONSTANT_2D;
  }

  eval3D(x: number, y: number, z: number): number {
    const stretchOffset = (x + y + z) * STRETCH_CONSTANT_3D;
    const xs = x + stretchOffset;
    const ys = y + stretchOffset;
    const zs = z + stretchOffset;

    const xsb = fastFloor(xs);
    const ysb = fastFloor(ys);
    const zsb = fastFloor(zs);

    const squishOffset = (xsb + ysb + zsb) * SQUISH_CONSTANT_3D;
    const xb = xsb + squishOffset;
    const yb = ysb + squishOffset;
    const zb = zsb + squishOffset;

    const xins = xs - xsb;
    const yins = ys - ysb;
    const zins = zs - zsb;

    const inSum = xins + yins + zins;

    let dx0 = x - xb;
    let dy0 = y - yb;
    let dz0 = z - zb;

    let dx_ext0: number, dy_ext0: number, dz_ext0: number;
    let dx_ext1: number, dy_ext1: number, dz_ext1: number;
    let xsv_ext0: number, ysv_ext0: number, zsv_ext0: number;
    let xsv_ext1: number, ysv_ext1: number, zsv_ext1: number;

    let value = 0;

    if (inSum <= 1) {
      // Tetrahedron at (0,0,0)
      let aPoint = 0x01;
      let aScore = xins;
      let bPoint = 0x02;
      let bScore = yins;
      if (aScore >= bScore && zins > bScore) {
        bScore = zins;
        bPoint = 0x04;
      } else if (aScore < bScore && zins > aScore) {
        aScore = zins;
        aPoint = 0x04;
      }

      const wins = 1 - inSum;
      if (wins > aScore || wins > bScore) {
        const c = bScore > aScore ? bPoint : aPoint;

        if ((c & 0x01) === 0) {
          xsv_ext0 = xsb - 1;
          xsv_ext1 = xsb;
          dx_ext0 = dx0 + 1;
          dx_ext1 = dx0;
        } else {
          xsv_ext0 = xsv_ext1 = xsb + 1;
          dx_ext0 = dx_ext1 = dx0 - 1;
        }

        if ((c & 0x02) === 0) {
          ysv_ext0 = ysv_ext1 = ysb;
          dy_ext0 = dy_ext1 = dy0;
          if ((c & 0x01) === 0) {
            ysv_ext1! -= 1;
            dy_ext1! += 1;
          } else {
            ysv_ext0! -= 1;
            dy_ext0! += 1;
          }
        } else {
          ysv_ext0 = ysv_ext1 = ysb + 1;
          dy_ext0 = dy_ext1 = dy0 - 1;
        }

        if ((c & 0x04) === 0) {
          zsv_ext0 = zsb;
          zsv_ext1 = zsb - 1;
          dz_ext0 = dz0;
          dz_ext1 = dz0 + 1;
        } else {
          zsv_ext0 = zsv_ext1 = zsb + 1;
          dz_ext0 = dz_ext1 = dz0 - 1;
        }
      } else {
        const c = aPoint | bPoint;

        if ((c & 0x01) === 0) {
          xsv_ext0 = xsb;
          xsv_ext1 = xsb - 1;
          dx_ext0 = dx0 - 2 * SQUISH_CONSTANT_3D;
          dx_ext1 = dx0 + 1 - SQUISH_CONSTANT_3D;
        } else {
          xsv_ext0 = xsv_ext1 = xsb + 1;
          dx_ext0 = dx0 - 1 - 2 * SQUISH_CONSTANT_3D;
          dx_ext1 = dx0 - 1 - SQUISH_CONSTANT_3D;
        }

        if ((c & 0x02) === 0) {
          ysv_ext0 = ysb;
          ysv_ext1 = ysb - 1;
          dy_ext0 = dy0 - 2 * SQUISH_CONSTANT_3D;
          dy_ext1 = dy0 + 1 - SQUISH_CONSTANT_3D;
        } else {
          ysv_ext0 = ysv_ext1 = ysb + 1;
          dy_ext0 = dy0 - 1 - 2 * SQUISH_CONSTANT_3D;
          dy_ext1 = dy0 - 1 - SQUISH_CONSTANT_3D;
        }

        if ((c & 0x04) === 0) {
          zsv_ext0 = zsb;
          zsv_ext1 = zsb - 1;
          dz_ext0 = dz0 - 2 * SQUISH_CONSTANT_3D;
          dz_ext1 = dz0 + 1 - SQUISH_CONSTANT_3D;
        } else {
          zsv_ext0 = zsv_ext1 = zsb + 1;
          dz_ext0 = dz0 - 1 - 2 * SQUISH_CONSTANT_3D;
          dz_ext1 = dz0 - 1 - SQUISH_CONSTANT_3D;
        }
      }

      // Contribution (0,0,0)
      let attn0 = 2 - dx0 * dx0 - dy0 * dy0 - dz0 * dz0;
      if (attn0 > 0) {
        attn0 *= attn0;
        value += attn0 * attn0 * this.extrapolate3D(xsb, ysb, zsb, dx0, dy0, dz0);
      }

      // Contribution (1,0,0)
      const dx1 = dx0 - 1 - SQUISH_CONSTANT_3D;
      const dy1 = dy0 - 0 - SQUISH_CONSTANT_3D;
      const dz1 = dz0 - 0 - SQUISH_CONSTANT_3D;
      let attn1 = 2 - dx1 * dx1 - dy1 * dy1 - dz1 * dz1;
      if (attn1 > 0) {
        attn1 *= attn1;
        value += attn1 * attn1 * this.extrapolate3D(xsb + 1, ysb, zsb, dx1, dy1, dz1);
      }

      // Contribution (0,1,0)
      const dx2 = dx0 - 0 - SQUISH_CONSTANT_3D;
      const dy2 = dy0 - 1 - SQUISH_CONSTANT_3D;
      const dz2 = dz1;
      let attn2 = 2 - dx2 * dx2 - dy2 * dy2 - dz2 * dz2;
      if (attn2 > 0) {
        attn2 *= attn2;
        value += attn2 * attn2 * this.extrapolate3D(xsb, ysb + 1, zsb, dx2, dy2, dz2);
      }

      // Contribution (0,0,1)
      const dx3 = dx2;
      const dy3 = dy1;
      const dz3 = dz0 - 1 - SQUISH_CONSTANT_3D;
      let attn3 = 2 - dx3 * dx3 - dy3 * dy3 - dz3 * dz3;
      if (attn3 > 0) {
        attn3 *= attn3;
        value += attn3 * attn3 * this.extrapolate3D(xsb, ysb, zsb + 1, dx3, dy3, dz3);
      }
    } else if (inSum >= 2) {
      // Tetrahedron at (1,1,1)
      let aPoint = 0x06;
      let aScore = xins;
      let bPoint = 0x05;
      let bScore = yins;
      if (aScore <= bScore && zins < bScore) {
        bScore = zins;
        bPoint = 0x03;
      } else if (aScore > bScore && zins < aScore) {
        aScore = zins;
        aPoint = 0x03;
      }

      const wins = 3 - inSum;
      if (wins < aScore || wins < bScore) {
        const c = bScore < aScore ? bPoint : aPoint;

        if ((c & 0x01) !== 0) {
          xsv_ext0 = xsb + 2;
          xsv_ext1 = xsb + 1;
          dx_ext0 = dx0 - 2 - 3 * SQUISH_CONSTANT_3D;
          dx_ext1 = dx0 - 1 - 3 * SQUISH_CONSTANT_3D;
        } else {
          xsv_ext0 = xsv_ext1 = xsb;
          dx_ext0 = dx_ext1 = dx0 - 3 * SQUISH_CONSTANT_3D;
        }

        if ((c & 0x02) !== 0) {
          ysv_ext0 = ysv_ext1 = ysb + 1;
          dy_ext0 = dy_ext1 = dy0 - 1 - 3 * SQUISH_CONSTANT_3D;
          if ((c & 0x01) !== 0) {
            ysv_ext1! += 1;
            dy_ext1! -= 1;
          } else {
            ysv_ext0! += 1;
            dy_ext0! -= 1;
          }
        } else {
          ysv_ext0 = ysv_ext1 = ysb;
          dy_ext0 = dy_ext1 = dy0 - 3 * SQUISH_CONSTANT_3D;
        }

        if ((c & 0x04) !== 0) {
          zsv_ext0 = zsb + 1;
          zsv_ext1 = zsb + 2;
          dz_ext0 = dz0 - 1 - 3 * SQUISH_CONSTANT_3D;
          dz_ext1 = dz0 - 2 - 3 * SQUISH_CONSTANT_3D;
        } else {
          zsv_ext0 = zsv_ext1 = zsb;
          dz_ext0 = dz_ext1 = dz0 - 3 * SQUISH_CONSTANT_3D;
        }
      } else {
        const c = aPoint & bPoint;

        if ((c & 0x01) !== 0) {
          xsv_ext0 = xsb + 1;
          xsv_ext1 = xsb + 2;
          dx_ext0 = dx0 - 1 - SQUISH_CONSTANT_3D;
          dx_ext1 = dx0 - 2 - 2 * SQUISH_CONSTANT_3D;
        } else {
          xsv_ext0 = xsv_ext1 = xsb;
          dx_ext0 = dx0 - SQUISH_CONSTANT_3D;
          dx_ext1 = dx0 - 2 * SQUISH_CONSTANT_3D;
        }

        if ((c & 0x02) !== 0) {
          ysv_ext0 = ysb + 1;
          ysv_ext1 = ysb + 2;
          dy_ext0 = dy0 - 1 - SQUISH_CONSTANT_3D;
          dy_ext1 = dy0 - 2 - 2 * SQUISH_CONSTANT_3D;
        } else {
          ysv_ext0 = ysv_ext1 = ysb;
          dy_ext0 = dy0 - SQUISH_CONSTANT_3D;
          dy_ext1 = dy0 - 2 * SQUISH_CONSTANT_3D;
        }

        if ((c & 0x04) !== 0) {
          zsv_ext0 = zsb + 1;
          zsv_ext1 = zsb + 2;
          dz_ext0 = dz0 - 1 - SQUISH_CONSTANT_3D;
          dz_ext1 = dz0 - 2 - 2 * SQUISH_CONSTANT_3D;
        } else {
          zsv_ext0 = zsv_ext1 = zsb;
          dz_ext0 = dz0 - SQUISH_CONSTANT_3D;
          dz_ext1 = dz0 - 2 * SQUISH_CONSTANT_3D;
        }
      }

      // Contribution (1,1,0)
      const dx3 = dx0 - 1 - 2 * SQUISH_CONSTANT_3D;
      const dy3 = dy0 - 1 - 2 * SQUISH_CONSTANT_3D;
      const dz3 = dz0 - 0 - 2 * SQUISH_CONSTANT_3D;
      let attn3 = 2 - dx3 * dx3 - dy3 * dy3 - dz3 * dz3;
      if (attn3 > 0) {
        attn3 *= attn3;
        value += attn3 * attn3 * this.extrapolate3D(xsb + 1, ysb + 1, zsb, dx3, dy3, dz3);
      }

      // Contribution (1,0,1)
      const dx2 = dx3;
      const dy2 = dy0 - 0 - 2 * SQUISH_CONSTANT_3D;
      const dz2 = dz0 - 1 - 2 * SQUISH_CONSTANT_3D;
      let attn2 = 2 - dx2 * dx2 - dy2 * dy2 - dz2 * dz2;
      if (attn2 > 0) {
        attn2 *= attn2;
        value += attn2 * attn2 * this.extrapolate3D(xsb + 1, ysb, zsb + 1, dx2, dy2, dz2);
      }

      // Contribution (0,1,1)
      const dx1 = dx0 - 0 - 2 * SQUISH_CONSTANT_3D;
      const dy1 = dy3;
      const dz1 = dz2;
      let attn1 = 2 - dx1 * dx1 - dy1 * dy1 - dz1 * dz1;
      if (attn1 > 0) {
        attn1 *= attn1;
        value += attn1 * attn1 * this.extrapolate3D(xsb, ysb + 1, zsb + 1, dx1, dy1, dz1);
      }

      // Contribution (1,1,1)
      dx0 = dx0 - 1 - 3 * SQUISH_CONSTANT_3D;
      dy0 = dy0 - 1 - 3 * SQUISH_CONSTANT_3D;
      dz0 = dz0 - 1 - 3 * SQUISH_CONSTANT_3D;
      let attn0 = 2 - dx0 * dx0 - dy0 * dy0 - dz0 * dz0;
      if (attn0 > 0) {
        attn0 *= attn0;
        value += attn0 * attn0 * this.extrapolate3D(xsb + 1, ysb + 1, zsb + 1, dx0, dy0, dz0);
      }
    } else {
      // Octahedron (Rectified 3-Simplex) in between
      let aScore: number;
      let aPoint: number;
      let aIsFurtherSide: boolean;
      let bScore: number;
      let bPoint: number;
      let bIsFurtherSide: boolean;

      const p1 = xins + yins;
      if (p1 > 1) {
        aScore = p1 - 1;
        aPoint = 0x03;
        aIsFurtherSide = true;
      } else {
        aScore = 1 - p1;
        aPoint = 0x04;
        aIsFurtherSide = false;
      }

      const p2 = xins + zins;
      if (p2 > 1) {
        bScore = p2 - 1;
        bPoint = 0x05;
        bIsFurtherSide = true;
      } else {
        bScore = 1 - p2;
        bPoint = 0x02;
        bIsFurtherSide = false;
      }

      const p3 = yins + zins;
      if (p3 > 1) {
        const score = p3 - 1;
        if (aScore <= bScore && aScore < score) {
          aScore = score;
          aPoint = 0x06;
          aIsFurtherSide = true;
        } else if (aScore > bScore && bScore < score) {
          bScore = score;
          bPoint = 0x06;
          bIsFurtherSide = true;
        }
      } else {
        const score = 1 - p3;
        if (aScore <= bScore && aScore < score) {
          aScore = score;
          aPoint = 0x01;
          aIsFurtherSide = false;
        } else if (aScore > bScore && bScore < score) {
          bScore = score;
          bPoint = 0x01;
          bIsFurtherSide = false;
        }
      }

      if (aIsFurtherSide === bIsFurtherSide) {
        if (aIsFurtherSide) {
          // Both closest points on (1,1,1) side
          dx_ext0 = dx0 - 1 - 3 * SQUISH_CONSTANT_3D;
          dy_ext0 = dy0 - 1 - 3 * SQUISH_CONSTANT_3D;
          dz_ext0 = dz0 - 1 - 3 * SQUISH_CONSTANT_3D;
          xsv_ext0 = xsb + 1;
          ysv_ext0 = ysb + 1;
          zsv_ext0 = zsb + 1;

          const c = aPoint & bPoint;
          if ((c & 0x01) !== 0) {
            dx_ext1 = dx0 - 2 - 2 * SQUISH_CONSTANT_3D;
            dy_ext1 = dy0 - 2 * SQUISH_CONSTANT_3D;
            dz_ext1 = dz0 - 2 * SQUISH_CONSTANT_3D;
            xsv_ext1 = xsb + 2;
            ysv_ext1 = ysb;
            zsv_ext1 = zsb;
          } else if ((c & 0x02) !== 0) {
            dx_ext1 = dx0 - 2 * SQUISH_CONSTANT_3D;
            dy_ext1 = dy0 - 2 - 2 * SQUISH_CONSTANT_3D;
            dz_ext1 = dz0 - 2 * SQUISH_CONSTANT_3D;
            xsv_ext1 = xsb;
            ysv_ext1 = ysb + 2;
            zsv_ext1 = zsb;
          } else {
            dx_ext1 = dx0 - 2 * SQUISH_CONSTANT_3D;
            dy_ext1 = dy0 - 2 * SQUISH_CONSTANT_3D;
            dz_ext1 = dz0 - 2 - 2 * SQUISH_CONSTANT_3D;
            xsv_ext1 = xsb;
            ysv_ext1 = ysb;
            zsv_ext1 = zsb + 2;
          }
        } else {
          // Both closest points on (0,0,0) side
          dx_ext0 = dx0;
          dy_ext0 = dy0;
          dz_ext0 = dz0;
          xsv_ext0 = xsb;
          ysv_ext0 = ysb;
          zsv_ext0 = zsb;

          const c = aPoint | bPoint;
          if ((c & 0x01) === 0) {
            dx_ext1 = dx0 + 1 - SQUISH_CONSTANT_3D;
            dy_ext1 = dy0 - 1 - SQUISH_CONSTANT_3D;
            dz_ext1 = dz0 - 1 - SQUISH_CONSTANT_3D;
            xsv_ext1 = xsb - 1;
            ysv_ext1 = ysb + 1;
            zsv_ext1 = zsb + 1;
          } else if ((c & 0x02) === 0) {
            dx_ext1 = dx0 - 1 - SQUISH_CONSTANT_3D;
            dy_ext1 = dy0 + 1 - SQUISH_CONSTANT_3D;
            dz_ext1 = dz0 - 1 - SQUISH_CONSTANT_3D;
            xsv_ext1 = xsb + 1;
            ysv_ext1 = ysb - 1;
            zsv_ext1 = zsb + 1;
          } else {
            dx_ext1 = dx0 - 1 - SQUISH_CONSTANT_3D;
            dy_ext1 = dy0 - 1 - SQUISH_CONSTANT_3D;
            dz_ext1 = dz0 + 1 - SQUISH_CONSTANT_3D;
            xsv_ext1 = xsb + 1;
            ysv_ext1 = ysb + 1;
            zsv_ext1 = zsb - 1;
          }
        }
      } else {
        // One point on (0,0,0) side, one point on (1,1,1) side
        let c1: number, c2: number;
        if (aIsFurtherSide) {
          c1 = aPoint;
          c2 = bPoint;
        } else {
          c1 = bPoint;
          c2 = aPoint;
        }

        if ((c1 & 0x01) === 0) {
          dx_ext0 = dx0 + 1 - SQUISH_CONSTANT_3D;
          dy_ext0 = dy0 - 1 - SQUISH_CONSTANT_3D;
          dz_ext0 = dz0 - 1 - SQUISH_CONSTANT_3D;
          xsv_ext0 = xsb - 1;
          ysv_ext0 = ysb + 1;
          zsv_ext0 = zsb + 1;
        } else if ((c1 & 0x02) === 0) {
          dx_ext0 = dx0 - 1 - SQUISH_CONSTANT_3D;
          dy_ext0 = dy0 + 1 - SQUISH_CONSTANT_3D;
          dz_ext0 = dz0 - 1 - SQUISH_CONSTANT_3D;
          xsv_ext0 = xsb + 1;
          ysv_ext0 = ysb - 1;
          zsv_ext0 = zsb + 1;
        } else {
          dx_ext0 = dx0 - 1 - SQUISH_CONSTANT_3D;
          dy_ext0 = dy0 - 1 - SQUISH_CONSTANT_3D;
          dz_ext0 = dz0 + 1 - SQUISH_CONSTANT_3D;
          xsv_ext0 = xsb + 1;
          ysv_ext0 = ysb + 1;
          zsv_ext0 = zsb - 1;
        }

        dx_ext1 = dx0 - 2 * SQUISH_CONSTANT_3D;
        dy_ext1 = dy0 - 2 * SQUISH_CONSTANT_3D;
        dz_ext1 = dz0 - 2 * SQUISH_CONSTANT_3D;
        xsv_ext1 = xsb;
        ysv_ext1 = ysb;
        zsv_ext1 = zsb;
        if ((c2 & 0x01) !== 0) {
          dx_ext1 -= 2;
          xsv_ext1 += 2;
        } else if ((c2 & 0x02) !== 0) {
          dy_ext1 -= 2;
          ysv_ext1 += 2;
        } else {
          dz_ext1 -= 2;
          zsv_ext1 += 2;
        }
      }

      // Contribution (1,0,0)
      const dx1 = dx0 - 1 - SQUISH_CONSTANT_3D;
      const dy1 = dy0 - 0 - SQUISH_CONSTANT_3D;
      const dz1 = dz0 - 0 - SQUISH_CONSTANT_3D;
      let attn1 = 2 - dx1 * dx1 - dy1 * dy1 - dz1 * dz1;
      if (attn1 > 0) {
        attn1 *= attn1;
        value += attn1 * attn1 * this.extrapolate3D(xsb + 1, ysb, zsb, dx1, dy1, dz1);
      }

      // Contribution (0,1,0)
      const dx2 = dx0 - 0 - SQUISH_CONSTANT_3D;
      const dy2 = dy0 - 1 - SQUISH_CONSTANT_3D;
      const dz2 = dz1;
      let attn2 = 2 - dx2 * dx2 - dy2 * dy2 - dz2 * dz2;
      if (attn2 > 0) {
        attn2 *= attn2;
        value += attn2 * attn2 * this.extrapolate3D(xsb, ysb + 1, zsb, dx2, dy2, dz2);
      }

      // Contribution (0,0,1)
      const dx3 = dx2;
      const dy3 = dy1;
      const dz3 = dz0 - 1 - SQUISH_CONSTANT_3D;
      let attn3 = 2 - dx3 * dx3 - dy3 * dy3 - dz3 * dz3;
      if (attn3 > 0) {
        attn3 *= attn3;
        value += attn3 * attn3 * this.extrapolate3D(xsb, ysb, zsb + 1, dx3, dy3, dz3);
      }

      // Contribution (1,1,0)
      const dx4 = dx0 - 1 - 2 * SQUISH_CONSTANT_3D;
      const dy4 = dy0 - 1 - 2 * SQUISH_CONSTANT_3D;
      const dz4 = dz0 - 0 - 2 * SQUISH_CONSTANT_3D;
      let attn4 = 2 - dx4 * dx4 - dy4 * dy4 - dz4 * dz4;
      if (attn4 > 0) {
        attn4 *= attn4;
        value += attn4 * attn4 * this.extrapolate3D(xsb + 1, ysb + 1, zsb, dx4, dy4, dz4);
      }

      // Contribution (1,0,1)
      const dx5 = dx4;
      const dy5 = dy0 - 0 - 2 * SQUISH_CONSTANT_3D;
      const dz5 = dz0 - 1 - 2 * SQUISH_CONSTANT_3D;
      let attn5 = 2 - dx5 * dx5 - dy5 * dy5 - dz5 * dz5;
      if (attn5 > 0) {
        attn5 *= attn5;
        value += attn5 * attn5 * this.extrapolate3D(xsb + 1, ysb, zsb + 1, dx5, dy5, dz5);
      }

      // Contribution (0,1,1)
      const dx6 = dx0 - 0 - 2 * SQUISH_CONSTANT_3D;
      const dy6 = dy4;
      const dz6 = dz5;
      let attn6 = 2 - dx6 * dx6 - dy6 * dy6 - dz6 * dz6;
      if (attn6 > 0) {
        attn6 *= attn6;
        value += attn6 * attn6 * this.extrapolate3D(xsb, ysb + 1, zsb + 1, dx6, dy6, dz6);
      }
    }

    // Extra vertices
    let attn_ext0 = 2 - dx_ext0! * dx_ext0! - dy_ext0! * dy_ext0! - dz_ext0! * dz_ext0!;
    if (attn_ext0 > 0) {
      attn_ext0 *= attn_ext0;
      value +=
        attn_ext0 * attn_ext0 * this.extrapolate3D(xsv_ext0!, ysv_ext0!, zsv_ext0!, dx_ext0!, dy_ext0!, dz_ext0!);
    }

    let attn_ext1 = 2 - dx_ext1! * dx_ext1! - dy_ext1! * dy_ext1! - dz_ext1! * dz_ext1!;
    if (attn_ext1 > 0) {
      attn_ext1 *= attn_ext1;
      value +=
        attn_ext1 * attn_ext1 * this.extrapolate3D(xsv_ext1!, ysv_ext1!, zsv_ext1!, dx_ext1!, dy_ext1!, dz_ext1!);
    }

    return value / NORM_CONSTANT_3D;
  }

  private extrapolate2D(xsb: number, ysb: number, dx: number, dy: number): number {
    const index = this.perm[(this.perm[xsb & 0xff] + ysb) & 0xff] & 0x0e;
    return GRADIENTS_2D[index] * dx + GRADIENTS_2D[index + 1] * dy;
  }

  private extrapolate3D(xsb: number, ysb: number, zsb: number, dx: number, dy: number, dz: number): number {
    const index = this.permGradIndex3D[(this.perm[(this.perm[xsb & 0xff] + ysb) & 0xff] + zsb) & 0xff];
    return GRADIENTS_3D[index] * dx + GRADIENTS_3D[index + 1] * dy + GRADIENTS_3D[index + 2] * dz;
  }
}

/** Fractal Brownian Motion using 3D noise with cylindrical wrapping */
export function fBm3D(
  noise: OpenSimplexNoise,
  sx: number,
  y: number,
  cx: number,
  octaves: number,
  frequency: number,
  persistence: number,
  lacunarity: number
): number {
  let sum = 0;
  let range = 0;
  let f = frequency;
  let a = 1;
  for (let o = 0; o < octaves; o++) {
    sum += noise.eval3D(sx * f, y * f, cx * f) * a;
    range += a;
    f *= lacunarity;
    a *= persistence;
  }
  return sum / Math.max(range, 1);
}
