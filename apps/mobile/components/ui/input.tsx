import { cn } from "@/lib/utils";
import type { Ref } from "react";
import { TextInput, type TextInputProps } from "react-native";
import { BottomSheetTextInput } from "@gorhom/bottom-sheet";
import { cssInterop } from "nativewind";

const SheetInput = cssInterop(BottomSheetTextInput, { className: "style" });

export function Input({
  className,
  inSheet = false,
  ref,
  ...props
}: TextInputProps & { ref?: Ref<TextInput>; inSheet?: boolean }) {
  const classes = cn(
    "min-h-12 rounded-md border border-input bg-background px-3 py-3 text-base text-foreground placeholder:text-muted-foreground",
    className,
  );
  if (inSheet)
    return (
      <SheetInput
        className={classes}
        {...props}
        ref={(input) => {
          if (typeof ref === "function") return ref(input ?? null);
          if (ref) ref.current = input ?? null;
        }}
      />
    );
  return <TextInput className={classes} {...props} ref={ref} />;
}
