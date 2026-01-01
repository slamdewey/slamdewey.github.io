import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class ScrollLockService {
  private readonly document = inject(DOCUMENT);

  public enableScrollLock(): void {
    this.document.body.style.overflow = 'hidden';
  }

  public disableScrollLock(): void {
    this.document.body.style.overflow = 'auto';
  }
}
