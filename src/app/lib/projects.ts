import { WritableSignal } from '@angular/core';
import { Backdrop } from '../components/backdrop';

export interface ProjectTileData {
  routerLink: string;
  labelText: string;
  backdrop: Backdrop;
  hovered: WritableSignal<boolean>;
  focused: WritableSignal<boolean>;
  onMouseEnter?: () => void;
  onMouseExit?: () => void;
}
