export type ActionListener = () => void;

export type KeyEventType = 'down' | 'up';

export type AxisKeyBinding = {
  axis: string;
  axisDirection: 1 | -1;
}

export type ActionKeyBinding = {
  action: string;
}

export type KeyBinding = ActionKeyBinding | AxisKeyBinding | (ActionKeyBinding & AxisKeyBinding)