import { AlertTriangle } from "lucide-react";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function QueryError({
  message = "Something went wrong loading this data.",
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTriangle />
      <AlertTitle>Couldn&apos;t load this</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
      {onRetry && (
        <AlertAction>
          <Button variant="outline" size="sm" onClick={onRetry}>
            Retry
          </Button>
        </AlertAction>
      )}
    </Alert>
  );
}
