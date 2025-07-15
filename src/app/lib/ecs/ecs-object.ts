export abstract class EcsObject {
  private static _nextId = 0;
  public readonly id = EcsObject._nextId++;
  protected _isActive: boolean = true;

  public isActive(): boolean {
    return this._isActive;
  }

  public setActive(state: boolean) {
    this._isActive = state;
    if (state) {
      this.onActivate();
    } else {
      this.onDeactivate();
    }
  }

  public onActivate(): void {}
  public onDeactivate(): void {}
  public onDestroy(): void {}
}
