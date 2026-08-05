import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Sheet({
  open,
  onOpenChange,
  title,
  eyebrow,
  description,
  width = "md",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description: string;
  width?: "md" | "lg";
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/30" />
        <Dialog.Content
          className={cn(
            "fixed inset-y-0 right-0 z-50 h-full w-full overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl outline-none dark:border-slate-800 dark:bg-slate-950",
            width === "lg" ? "max-w-lg" : "max-w-md",
          )}
        >
          <Dialog.Description className="sr-only">
            {description}
          </Dialog.Description>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-xs text-slate-400">{eyebrow}</p>
              )}
              <Dialog.Title className="mt-1 break-words text-lg font-semibold text-slate-900 dark:text-white">
                {title}
              </Dialog.Title>
            </div>
            <Dialog.Close
              className="quiet-button shrink-0 px-2"
              aria-label="关闭详情"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
