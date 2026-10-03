"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Label as LabelPrimitive } from "@radix-ui/react-label";

function Label({
  className,
  ...props
}: React.ComponentProps<typeof LabelPrimitive>) {
  return (
    <LabelPrimitive
      data-slot="label"
      className={cn(
        "flex select-none items-center gap-2 text-sm font-medium leading-none underline-offset-4 hover:underline",
        className
      )}
      {...props}
    />
  );
}

export { Label };
