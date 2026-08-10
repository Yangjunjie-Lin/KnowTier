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
  placement = "right",
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  eyebrow?: ReactNode;
  description: string;
  width?: "md" | "lg";
  placement?: "right" | "bottom" | "responsive";
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 overscroll-contain bg-slate-950/45 backdrop-blur-[2px]" />
        <Dialog.Content
          className={cn(
            "fixed z-50 w-full max-w-full overflow-y-auto overscroll-contain border-slate-200 bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[max(1.25rem,env(safe-area-inset-top))] shadow-2xl outline-none dark:border-slate-800 dark:bg-slate-950 sm:p-6 sm:pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:pt-[max(1.5rem,env(safe-area-inset-top))]",
            placement === "right" &&
              "inset-y-0 right-0 h-full max-h-[100dvh] border-l sm:rounded-l-2xl",
            placement === "bottom" &&
              "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl border-t",
            placement === "responsive" &&
              "inset-x-0 bottom-0 max-h-[88dvh] rounded-t-3xl border-t md:inset-y-0 md:left-auto md:right-0 md:h-full md:max-h-none md:rounded-l-2xl md:rounded-r-none md:border-l md:border-t-0",
            placement !== "bottom" &&
              (width === "lg" ? "md:max-w-lg" : "md:max-w-md"),
          )}
        >
          <Dialog.Description className="sr-only">
            {description}
          </Dialog.Description>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              {eyebrow && (
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#3157D5]">{eyebrow}</p>
              )}
              <Dialog.Title className="mt-1 break-words text-lg font-semibold text-slate-900 dark:text-white">
                {title}
              </Dialog.Title>
            </div>
            <Dialog.Close
              className="icon-button shrink-0"
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
