import * as React from "react"

import { cn } from "@/lib/utils"
import { controlSizes, type ControlSize } from "./control-sizes"

const Input = React.forwardRef<HTMLInputElement, Omit<React.ComponentProps<"input">, "size"> & { size?: ControlSize }>(
  ({ className, type, size = "default", ...props }, ref) => {
    return (
      <input
        data-slot="input"
        data-size={size}
        type={type}
        className={cn(
          "flex w-full min-w-0 rounded-md border border-input bg-transparent py-1 shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
          controlSizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export { Input }
