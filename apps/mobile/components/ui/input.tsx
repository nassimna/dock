import { cn } from "@/lib/utils";
import { TextInput, type TextInputProps } from "react-native";

export function Input({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      className={cn(
        "min-h-12 rounded-md border border-input bg-background px-3 py-3 text-base text-foreground placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
