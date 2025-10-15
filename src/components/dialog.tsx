import * as Headless from "@headlessui/react";
import clsx from "clsx";
import type React from "react";

import { Text } from "@/components/text";

const sizes = {
  xs: "sm:max-w-xs",
  sm: "sm:max-w-sm",
  md: "sm:max-w-md",
  lg: "sm:max-w-lg",
  xl: "sm:max-w-xl",
  "2xl": "sm:max-w-2xl",
  "3xl": "sm:max-w-3xl",
  "4xl": "sm:max-w-4xl",
  "5xl": "sm:max-w-5xl",
};

export function Dialog({
  size = "lg",
  className,
  children,
  variant = "modal",
  ...props
}: {
  size?: keyof typeof sizes;
  className?: string;
  children: React.ReactNode;
  variant?: "modal" | "slideout";
} & Omit<Headless.DialogProps, "as" | "className">) {
  return (
    <Headless.Dialog {...props}>
      {variant === "modal" && (
        <Headless.DialogBackdrop
          transition
          className="fixed inset-0 z-40 flex w-screen justify-center overflow-y-auto bg-zinc-950/25 px-2 py-2 transition duration-100 focus:outline-0 data-[closed]:opacity-0 data-[enter]:ease-out data-[leave]:ease-in sm:px-6 sm:py-8 lg:px-8 lg:py-16 dark:bg-zinc-950/50"
        />
      )}

      {variant === "modal" ? (
        <div className="fixed inset-0 z-50 isolate w-screen overflow-y-auto pt-6 sm:pt-0">
          <div className="flex min-h-full items-center justify-center sm:p-4">
            <Headless.DialogPanel
              transition
              className={clsx(className, sizes[size], "w-full")}
            >
              {children}
            </Headless.DialogPanel>
          </div>
        </div>
      ) : (
        <Headless.DialogPanel
          transition
          className={clsx(
            className,
            "fixed inset-y-0 right-0 z-50 w-full overflow-y-auto bg-white dark:bg-black transition duration-300 ease-in-out data-[closed]:translate-x-full",
            "sm:max-w-sm",
          )}
        >
          {children}
        </Headless.DialogPanel>
      )}
    </Headless.Dialog>
  );
}

export function DialogTitle({
  className,
  ...props
}: { className?: string } & Omit<
  Headless.DialogTitleProps,
  "as" | "className"
>) {
  return (
    <Headless.DialogTitle
      {...props}
      className={clsx(
        className,
        "text-balance text-lg/6 font-semibold text-zinc-950 sm:text-base/6 dark:text-white",
      )}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: { className?: string } & Omit<
  Headless.DescriptionProps<typeof Text>,
  "as" | "className"
>) {
  return (
    <Headless.Description
      as={Text}
      {...props}
      className={clsx(className, "mt-2 text-pretty")}
    />
  );
}

export function DialogBody({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={clsx(className, "mt-6")} />;
}

export function DialogActions({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"div">) {
  return (
    <div
      {...props}
      className={clsx(
        className,
        "mt-8 flex flex-col-reverse items-center justify-end gap-3 *:w-full sm:flex-row sm:*:w-auto",
      )}
    />
  );
}
