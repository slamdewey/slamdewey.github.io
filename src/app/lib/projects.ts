import { Backdrop } from '../components/backdrop';

export interface ProjectTileData {
  routerLink: string;
  labelText: string;
  backdrop: Backdrop;
  onMouseEnter?: () => void;
  onMouseExit?: () => void;
}
