import { Injectable } from '@angular/core';

export interface RenderableBackdrop {
  renderFrame(deltaTime: number): void;
}

@Injectable({ providedIn: 'root' })
export class BackdropService {
  private readonly activeComponents = new Set<RenderableBackdrop>();
  private animationFrameId: number | null = null;
  private lastTimestamp = 0;

  register(component: RenderableBackdrop): void {
    this.activeComponents.add(component);
    if (this.activeComponents.size === 1) {
      this.startLoop();
    }
  }

  unregister(component: RenderableBackdrop): void {
    this.activeComponents.delete(component);
    if (this.activeComponents.size === 0) {
      this.stopLoop();
    }
  }

  private startLoop(): void {
    this.lastTimestamp = 0;
    this.animationFrameId = window.requestAnimationFrame(this.loop.bind(this));
  }

  private stopLoop(): void {
    if (this.animationFrameId !== null) {
      window.cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.lastTimestamp = 0;
  }

  private loop(): void {
    const now = Date.now();
    const deltaTime = (now - (this.lastTimestamp || now)) / 1000;
    this.lastTimestamp = now;

    this.activeComponents.forEach((component) => {
      component.renderFrame(deltaTime);
    });

    this.animationFrameId = window.requestAnimationFrame(this.loop.bind(this));
  }
}
