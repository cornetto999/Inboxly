import { AlertTriangle, LoaderCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/crm-ui";

export function CrmModuleLoading({ name }: { name: string }) {
  return (
    <PageShell>
      <Card className="flex min-h-64 flex-col items-center justify-center gap-3 border-dashed p-8 text-center">
        <LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground" />
        <div>
          <h1 className="text-xl font-semibold">Loading {name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Reading the latest records from the CRM database.
          </p>
        </div>
      </Card>
    </PageShell>
  );
}

export function CrmModuleUnavailable({ name }: { name: string }) {
  return (
    <PageShell>
      <Card className="flex min-h-64 flex-col items-center justify-center gap-3 border-amber-300 bg-amber-50/60 p-8 text-center dark:border-amber-900 dark:bg-amber-950/20">
        <AlertTriangle className="h-9 w-9 text-amber-600" />
        <div className="max-w-xl">
          <h1 className="text-xl font-semibold">{name} is unavailable</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            The production database has not applied the CRM expansion migration
            yet. This module is intentionally not shown as zero records because
            that would be inaccurate.
          </p>
        </div>
      </Card>
    </PageShell>
  );
}
