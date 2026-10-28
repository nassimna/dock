import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import { Text as RNText, type TextProps } from "react-native";

const textVariants = cva("text-foreground", {
  variants: {
    variant: {
      default: "text-base",
      title: "text-2xl font-bold",
      heading: "text-lg font-semibold",
      label: "text-sm font-medium",
      muted: "text-sm text-muted-foreground",
      mono: "text-sm font-mono",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Text({
  className,
  variant,
  ...props
}: TextProps & VariantProps<typeof textVariants>) {
  return (
    <RNText className={cn(textVariants({ variant }), className)} {...props} />
  );
}
