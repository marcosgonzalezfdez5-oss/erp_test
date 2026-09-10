import { PageHeader } from "@/components/page-header";
import { requirePage } from "@/lib/auth/page-guard";
import { SuggestionsInbox } from "./suggestions-inbox";

export default async function SuggestionsPage() {
  await requirePage();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col">
      <PageHeader
        title="Suggestions"
        description="Proposed changes from guided setup and automation. Nothing is applied until you approve it."
      />
      <SuggestionsInbox />
    </div>
  );
}
