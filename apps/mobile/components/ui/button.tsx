import { cn } from "@/lib/utils";
import { type VariantProps, cva } from "class-variance-authority";
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  View,
} from "react-native";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";

const buttonVariants = cva(
  "flex-row items-center justify-center gap-2 rounded-md px-4",
  {
    variants: {
      variant: {
        default: "bg-primary",
        secondary: "bg-secondary",
        outline: "border border-border bg-card",
        destructive: "bg-destructive",
        ghost: "bg-transparent",
      },
      size: {
        default: "h-12",
        sm: "h-12 px-3",
      },
      iconOnly: {
        true: "w-12 px-0",
        false: "",
      },
    },
    defaultVariants: { variant: "default", size: "default", iconOnly: false },
  },
);

const labelVariants = cva("font-semibold", {
  variants: {
    variant: {
      default: "text-primary-foreground",
      secondary: "text-secondary-foreground",
      outline: "text-foreground",
      destructive: "text-destructive-foreground",
      ghost: "text-foreground",
    },
    size: {
      default: "text-base",
      sm: "text-sm",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = PressableProps &
  VariantProps<typeof buttonVariants> & {
    /** Always required: it is the accessible name even when only the icon shows. */
    label: string;
    loading?: boolean;
    icon?: IconName;
    iconOnly?: boolean;
  };

export function Button({
  className,
  variant,
  size,
  label,
  loading = false,
  icon,
  iconOnly = false,
  disabled,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      accessibilityState={{ disabled: !!isDisabled, busy: loading }}
      className={cn(
        buttonVariants({ variant, size, iconOnly }),
        isDisabled && "opacity-50",
        className,
      )}
      disabled={isDisabled}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" />
      ) : (
        <>
          {icon ? (
            <Icon
              className={cn(labelVariants({ variant, size }))}
              name={icon}
              size={size === "sm" ? 16 : 18}
            />
          ) : null}
          {iconOnly ? null : (
            <View>
              <Text className={cn(labelVariants({ variant, size }))}>
                {label}
              </Text>
            </View>
          )}
        </>
      )}
    </Pressable>
  );
}
