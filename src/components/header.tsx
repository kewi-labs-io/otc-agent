"use client";

import { XMarkIcon, Bars3Icon } from "@heroicons/react/24/outline";
import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { usePathname } from "next/navigation";

import { Dialog } from "@/components/dialog";
import { Logo } from "@/components/logo";

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const pathname = usePathname();

  const NavLinks = ({ mobile = false }) => (
    <>
      <Link
        href="/"
        className={clsx(
          "text-sm font-semibold m-1 p-1",
          mobile
            ? clsx(
                "-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900",
                pathname === "/"
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-600 dark:text-zinc-400",
              )
            : clsx(
                pathname === "/"
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-600 dark:text-zinc-400",
                "hover:text-zinc-900 dark:hover:text-white",
              ),
        )}
        onClick={() => setMobileMenuOpen(false)}
        aria-current={pathname === "/" ? "page" : undefined}
      >
        Trading Desk
      </Link>
      <Link
        href="/my-deals"
        className={clsx(
          "text-sm font-semibold m-1 p-1",
          mobile
            ? clsx(
                "-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900",
                pathname === "/my-deals"
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-600 dark:text-zinc-400",
              )
            : clsx(
                pathname === "/my-deals"
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-600 dark:text-zinc-400",
                "hover:text-zinc-900 dark:hover:text-white",
              ),
        )}
        onClick={() => setMobileMenuOpen(false)}
        aria-current={pathname === "/my-deals" ? "page" : undefined}
      >
        My Deals
      </Link>
      <Link
        href="/how-it-works"
        className={clsx(
          "text-sm font-semibold m-1 p-1",
          mobile
            ? clsx(
                "-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900",
                pathname === "/how-it-works"
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-600 dark:text-zinc-400",
              )
            : clsx(
                pathname === "/how-it-works"
                  ? "text-zinc-900 dark:text-white"
                  : "text-zinc-600 dark:text-zinc-400",
                "hover:text-zinc-900 dark:hover:text-white",
              ),
        )}
        onClick={() => setMobileMenuOpen(false)}
        aria-current={pathname === "/how-it-works" ? "page" : undefined}
      >
        How It Works
      </Link>
      {mobile && (
        <>
          <Link
            href="/consign"
            className={clsx(
              "-mx-3 block rounded-lg px-3 py-2 text-base/7 font-semibold hover:bg-zinc-50 dark:hover:bg-zinc-900",
              pathname === "/consign"
                ? "text-zinc-900 dark:text-white"
                : "text-zinc-600 dark:text-zinc-400",
            )}
            onClick={() => setMobileMenuOpen(false)}
            aria-current={pathname === "/consign" ? "page" : undefined}
          >
            Create Listing
          </Link>
          <div className="my-2 border-t border-zinc-200 dark:border-zinc-800" />
          <Link
            href="/terms"
            className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            onClick={() => setMobileMenuOpen(false)}
          >
            Terms of Service
          </Link>
          <Link
            href="/privacy"
            className="-mx-3 block rounded-lg px-3 py-2 text-base/7 font-medium text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
            onClick={() => setMobileMenuOpen(false)}
          >
            Privacy Policy
          </Link>
        </>
      )}
    </>
  );

  return (
    <header className="z-20 bg-transparent">
      <nav className="px-3 sm:px-4 lg:px-6 w-full" aria-label="Global">
        <div className="flex items-center justify-between py-3 sm:py-4 gap-2 sm:gap-4 flex-nowrap">
          <div className="flex shrink-0 min-w-0">
            <Link href="/" className="-m-1.5 p-1.5">
              <div className="w-[180px] sm:w-[240px] lg:w-[290px]">
                <Logo width={290} height={22} className="w-full h-auto" />
              </div>
            </Link>
          </div>

          <div className="hidden lg:flex flex-1 min-w-0 items-center justify-center gap-x-3 overflow-x-auto whitespace-nowrap">
            <NavLinks />
          </div>
          <div className="flex items-center justify-end whitespace-nowrap shrink-0 gap-1.5 sm:gap-2">
            <Link
              href="/consign"
              className="hidden lg:block px-4 py-2 bg-orange-600 text-white text-sm font-semibold rounded-lg hover:bg-orange-700 transition-colors"
            >
              Create Listing
            </Link>
            <button
              type="button"
              className="lg:hidden -m-2 inline-flex items-center justify-center rounded-md p-2 text-zinc-700 dark:text-zinc-400"
              onClick={() => setMobileMenuOpen(true)}
            >
              <span className="sr-only">Open main menu</span>
              <Bars3Icon className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden="true" />
            </button>
          </div>
        </div>
      </nav>
    </header>
  );
}
