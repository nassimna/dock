import Ionicons from "@expo/vector-icons/Ionicons";
import { cssInterop } from "nativewind";
import type { ComponentProps } from "react";
import { I18nManager } from "react-native";

// Resolve icon color from the same NativeWind tokens as surrounding text.
const StyledIonicons = cssInterop(Ionicons, {
  className: {
    target: "style",
    nativeStyleToProp: { color: true },
  },
});

export type IconName = keyof typeof Ionicons.glyphMap;

// Glyphs that point along the reading direction. Ionicons draws them for
// left-to-right only, so in Arabic a "forward" chevron would point backwards.
const DIRECTIONAL = new Set<IconName>([
  "arrow-back",
  "arrow-back-outline",
  "arrow-forward",
  "arrow-forward-outline",
  "chevron-back",
  "chevron-forward",
]);

const MIRRORED = { transform: [{ scaleX: -1 }] };

export function Icon(props: ComponentProps<typeof StyledIonicons>) {
  if (!I18nManager.isRTL || !DIRECTIONAL.has(props.name)) {
    return <StyledIonicons {...props} />;
  }
  return <StyledIonicons {...props} style={[MIRRORED, props.style]} />;
}
