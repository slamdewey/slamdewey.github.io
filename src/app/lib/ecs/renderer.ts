import { EcsRenderableComponent } from "./component";
import { EcsCamera } from "./camera";

export abstract class EcsRenderer<ctx extends RenderingContext> {
  public abstract render(ctx: ctx, renderables: Set<EcsRenderableComponent>, camera: EcsCamera): void;
}

export class CanvasContext2DRenderer extends EcsRenderer<CanvasRenderingContext2D> {
  private targetGameWidth = 800;
  private targetGameHeight = 600;

  public render(ctx: CanvasRenderingContext2D, renderables: Set<EcsRenderableComponent>, camera: EcsCamera): void {
    // Clear the entire canvas
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

    // Calculate scaling to maintain aspect ratio
    const scaleX = ctx.canvas.width / this.targetGameWidth;
    const scaleY = ctx.canvas.height / this.targetGameHeight;
    const scale = Math.min(scaleX, scaleY);

    // Calculate offsets for centering (letterboxing/pillarboxing)
    const offsetX = (ctx.canvas.width - this.targetGameWidth * scale) / 2;
    const offsetY = (ctx.canvas.height - this.targetGameHeight * scale) / 2;

    ctx.save();

    // Apply aspect ratio correction and centering
    ctx.translate(offsetX, offsetY);
    ctx.scale(scale, scale);

    // Translate to center the world origin (0,0) in the viewport
    ctx.translate(this.targetGameWidth / 2, this.targetGameHeight / 2);

    // Apply camera view transformation
    const cameraViewMatrix = camera.getViewMatrix();
    ctx.transform(
      cameraViewMatrix.a,
      cameraViewMatrix.b,
      cameraViewMatrix.c,
      cameraViewMatrix.d,
      cameraViewMatrix.e,
      cameraViewMatrix.f
    );

    renderables.forEach((c) => {
      ctx.save();

      // Apply component's local transformation
      const componentTransform = c.transform.getTransformationMatrix();
      ctx.transform(
        componentTransform.a,
        componentTransform.b,
        componentTransform.c,
        componentTransform.d,
        componentTransform.e,
        componentTransform.f
      );

      c.render(ctx);

      ctx.restore();
    });

    ctx.restore();
  }
}