import { Canvas2dBackdrop } from '@components/backdrop/backdrop';

/**
 * Surveillance-themed tile thumbnail for the Scry project: a dark viewport
 * with a faint grid, a scan line sweeping across, corner viewfinder brackets,
 * and a blinking "recording" dot. Purely decorative.
 */
export class ScryBackdrop extends Canvas2dBackdrop {
  private time = 0;

  private static readonly SWEEP_PERIOD_S = 4;
  private static readonly GRID_STEP_PX = 28;

  protected update(deltaTime: number): void {
    this.time += deltaTime;
  }

  protected draw(): void {
    const { ctx, width, height } = this;
    if (!width || !height) return;

    // Base
    ctx.fillStyle = '#0b0e18';
    ctx.fillRect(0, 0, width, height);

    // Faint grid
    ctx.strokeStyle = 'rgba(139, 233, 253, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= width; x += ScryBackdrop.GRID_STEP_PX) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    for (let y = 0; y <= height; y += ScryBackdrop.GRID_STEP_PX) {
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
    }
    ctx.stroke();

    // Sweeping scan line with a trailing gradient
    const t = (this.time % ScryBackdrop.SWEEP_PERIOD_S) / ScryBackdrop.SWEEP_PERIOD_S;
    const sweepX = t * (width + 80) - 40;
    const trail = 70;
    const grad = ctx.createLinearGradient(sweepX - trail, 0, sweepX, 0);
    grad.addColorStop(0, 'rgba(139, 233, 253, 0)');
    grad.addColorStop(1, 'rgba(139, 233, 253, 0.28)');
    ctx.fillStyle = grad;
    ctx.fillRect(sweepX - trail, 0, trail, height);
    ctx.strokeStyle = 'rgba(139, 233, 253, 0.55)';
    ctx.beginPath();
    ctx.moveTo(sweepX, 0);
    ctx.lineTo(sweepX, height);
    ctx.stroke();

    // Corner viewfinder brackets
    this.drawBrackets(ctx, width, height);

    // Blinking record dot
    if (Math.sin(this.time * Math.PI * 2) > 0) {
      ctx.fillStyle = '#ff5555';
      ctx.beginPath();
      ctx.arc(20, 20, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawBrackets(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const m = 14; // margin
    const len = 18; // bracket arm length
    ctx.strokeStyle = 'rgba(139, 233, 253, 0.5)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    // Top-left
    ctx.moveTo(m, m + len);
    ctx.lineTo(m, m);
    ctx.lineTo(m + len, m);
    // Top-right
    ctx.moveTo(width - m - len, m);
    ctx.lineTo(width - m, m);
    ctx.lineTo(width - m, m + len);
    // Bottom-left
    ctx.moveTo(m, height - m - len);
    ctx.lineTo(m, height - m);
    ctx.lineTo(m + len, height - m);
    // Bottom-right
    ctx.moveTo(width - m - len, height - m);
    ctx.lineTo(width - m, height - m);
    ctx.lineTo(width - m, height - m - len);
    ctx.stroke();
  }
}
