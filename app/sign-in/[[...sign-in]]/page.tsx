import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 py-16">
      <span className="flex size-10 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">
        E
      </span>
      <SignIn appearance={{ variables: { colorPrimary: "#2f5ce0" } }} />
    </div>
  );
}
