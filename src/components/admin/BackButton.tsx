"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();

  const handleClick = (e: React.MouseEvent) => {
    if (window.history.length > 1) {
      e.preventDefault();
      router.back();
    }
  };

  return (
    <Link
      href="/"
      onClick={handleClick}
      className="flex h-9 w-9 items-center justify-center rounded-full bg-muted hover:bg-muted/80"
      aria-label="Volver"
    >
      <span className="material-symbols-outlined text-xl">arrow_back</span>
    </Link>
  );
}
