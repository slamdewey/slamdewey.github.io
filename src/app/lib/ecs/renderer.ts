import { EcsRenderableComponent } from "./component";

export abstract class EcsRenderer<ctx extends RenderingContext> {
  public abstract render(ctx: ctx, renderables: Set<EcsRenderableComponent>): void;
}

export class CanvasContext2DRenderer extends EcsRenderer<CanvasRenderingContext2D> {
  public render(ctx: CanvasRenderingContext2D, renderables: Set<EcsRenderableComponent>): void {
    const cameraTransform = ctx.getTransform();
    renderables.forEach((c) => {
      ctx.save();

      const componentTransform = c.transform.getTransformationMatrix() ?? new DOMMatrix();
      ctx.setTransform(cameraTransform.multiply(componentTransform));
      c.render(ctx);

      ctx.restore();
    });
  }
}