import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-6 py-16 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
          E
        </span>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-foreground">erp_test</h1>
        <p className="max-w-md text-sm text-muted-foreground">
          A configurable sales pipeline for teams that outgrew spreadsheets — leads, opportunities, quotes, and
          reporting in one place.
        </p>
      </div>
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link href="/sign-in">Sign in</Link>
        </Button>
        <Button asChild>
          <Link href="/sign-up">Sign up</Link>
        </Button>
      </div>
    </div>
  );
}
