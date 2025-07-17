export type ActionListener = () => void;

export type KeyEventType = 'down' | 'up';

export interface AxisKeyBinding {
  axis: string;
  axisDirection: 1 | -1;
}

export interface ActionKeyBinding {
  action: string;
}

export type KeyBinding = ActionKeyBinding | AxisKeyBinding | (ActionKeyBinding & AxisKeyBinding);
