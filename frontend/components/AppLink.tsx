"use client";

import Link, { type LinkProps } from "next/link";
import type { AnchorHTMLAttributes, ReactNode } from "react";
import { withTrailingSlash } from "@/lib/withTrailingSlash";

type AppLinkProps = Omit<LinkProps, "href"> &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof LinkProps> & {
    href: string;
    children?: ReactNode;
  };

/**
 * Next Link that always navigates with a trailing slash.
 * Required while `trailingSlash: true` + `skipTrailingSlashRedirect: true`
 * (backend proxy must not get forced slashes).
 */
export default function AppLink({ href, ...rest }: AppLinkProps) {
  return <Link href={withTrailingSlash(href)} {...rest} />;
}
