"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

interface PasswordInputProps {
  id: string;
  name: string;
  autoComplete: string;
  placeholder: string;
  defaultValue?: string;
  minLength?: number;
}

export function PasswordInput({
  id,
  name,
  autoComplete,
  placeholder,
  defaultValue = "",
  minLength,
}: PasswordInputProps) {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        type={visible ? "text" : "password"}
        autoComplete={autoComplete}
        required
        placeholder={placeholder}
        defaultValue={defaultValue}
        minLength={minLength}
        className="pr-10"
      />
      <button
        type="button"
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
        onClick={() => setVisible((current) => !current)}
        aria-label={visible ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
        aria-pressed={visible}
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}
