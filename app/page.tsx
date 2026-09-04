import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 bg-zinc-50 py-16 dark:bg-black">
      <h1 className="text-3xl font-semibold text-black dark:text-zinc-50">erp_test</h1>
      <div className="flex gap-4">
        <Link
          href="/sign-in"
          className="rounded-full border border-solid border-black/[.08] px-5 py-3 font-medium transition-colors hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
        >
          Sign in
        </Link>
        <Link
          href="/sign-up"
          className="rounded-full bg-foreground px-5 py-3 font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Sign up
        </Link>
      </div>
    </div>
  );
}
