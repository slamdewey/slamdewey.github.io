import { Backdrop } from '../components/backdrop';

export type ProjectTileData = {
  routerLink: string;
  labelText: string;
  backdrop: Backdrop;
  onMouseEnter?: () => void;
  onMouseExit?: () => void;
};
