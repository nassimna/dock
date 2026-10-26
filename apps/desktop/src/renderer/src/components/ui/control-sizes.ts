export const controlSizes = {
  default: "h-(--control-default) px-3 text-sm",
  sm: "h-(--control-sm) px-2.5 text-sm",
  xs: "h-(--control-xs) px-2 text-xs",
};

export type ControlSize = keyof typeof controlSizes;
