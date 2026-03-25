"use client";

import ParentLayout from "./_layout/ParentLayout";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <ParentLayout>{children}</ParentLayout>;
}