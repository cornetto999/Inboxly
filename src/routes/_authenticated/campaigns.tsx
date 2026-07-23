import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  deleteCampaign,
  listCampaigns,
  upsertCampaign,
} from "@/lib/crm.functions";
import { DueDatePicker } from "@/components/due-date-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  EmptyState,
  FormPanel,
  MetricStrip,
  PageHeader,
  PageShell,
} from "@/components/crm-ui";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Megaphone, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  CrmModuleLoading,
  CrmModuleUnavailable,
} from "@/components/crm-module-state";

export const Route = createFileRoute("/_authenticated/campaigns")({
  head: () => ({ meta: [{ title: "Campaigns - Inboxly" }] }),
  component: CampaignsPage,
});

const CAMPAIGN_STATUSES = [
  "draft",
  "active",
  "scheduled",
  "completed",
  "cancelled",
] as const;

type CampaignForm = {
  id?: string;
  name: string;
  subject: string;
  body: string;
  status: (typeof CAMPAIGN_STATUSES)[number];
  scheduled_at: string;
};

const emptyCampaign: CampaignForm = {
  name: "",
  subject: "",
  body: "",
  status: "draft",
  scheduled_at: "",
};

function CampaignsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listCampaigns);
  const saveFn = useServerFn(upsertCampaign);
  const deleteFn = useServerFn(deleteCampaign);
  const [form, setForm] = useState<CampaignForm>(emptyCampaign);

  const {
    data: campaigns = [],
    isPending: campaignsLoading,
    isError: campaignsUnavailable,
  } = useQuery({
    queryKey: ["campaigns"],
    queryFn: () => listFn(),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["campaigns"] });
    qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...form,
          scheduled_at: form.scheduled_at || undefined,
        },
      }),
    onSuccess: () => {
      setForm(emptyCampaign);
      toast.success("Campaign saved");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Campaign deleted");
      invalidate();
    },
  });

  const active = campaigns.filter(
    (campaign) => campaign.status === "active",
  ).length;
  const scheduled = campaigns.filter(
    (campaign) => campaign.status === "scheduled",
  ).length;

  if (campaignsLoading) {
    return <CrmModuleLoading name="campaigns" />;
  }

  if (campaignsUnavailable) {
    return <CrmModuleUnavailable name="Campaigns" />;
  }

  return (
    <PageShell>
      <PageHeader
        title="Campaigns"
        description="Store campaign drafts, schedule plans, and delivery metrics."
      >
        <MetricStrip
          items={[
            { label: "Active", value: active },
            { label: "Scheduled", value: scheduled },
          ]}
        />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <FormPanel
          icon={Megaphone}
          title={form.id ? "Edit campaign" : "New campaign"}
          description="Unsubscribed contacts are excluded at send time."
        >
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Subject</Label>
            <Input
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Content</Label>
            <Textarea
              rows={8}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select
              value={form.status}
              onValueChange={(status) =>
                setForm({ ...form, status: status as CampaignForm["status"] })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAMPAIGN_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Schedule</Label>
            <DueDatePicker
              value={form.scheduled_at}
              onChange={(scheduled_at) => setForm({ ...form, scheduled_at })}
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              disabled={
                !form.name || !form.subject || !form.body || save.isPending
              }
              onClick={() => save.mutate()}
            >
              Save
            </Button>
            {form.id && (
              <Button variant="outline" onClick={() => setForm(emptyCampaign)}>
                Cancel
              </Button>
            )}
          </div>
        </FormPanel>

        {campaigns.length === 0 ? (
          <EmptyState
            icon={Megaphone}
            title="No campaigns"
            description="Create a draft campaign to begin."
          />
        ) : (
          <div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Performance</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {campaigns.map((campaign) => (
                  <TableRow key={campaign.id}>
                    <TableCell>
                      <button
                        className="text-left"
                        onClick={() =>
                          setForm({
                            id: campaign.id,
                            name: campaign.name,
                            subject: campaign.subject,
                            body: campaign.body,
                            status: campaign.status,
                            scheduled_at: campaign.scheduled_at
                              ? campaign.scheduled_at.slice(0, 16)
                              : "",
                          })
                        }
                      >
                        <div className="font-medium">{campaign.name}</div>
                        <div className="line-clamp-1 text-sm text-muted-foreground">
                          {campaign.subject}
                        </div>
                      </button>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{campaign.status}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {campaign.scheduled_at
                        ? format(new Date(campaign.scheduled_at), "PPp")
                        : "Not scheduled"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      Sent {campaign.sent_count} / Replies{" "}
                      {campaign.reply_count} / Failed {campaign.failed_count}
                    </TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => remove.mutate(campaign.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </PageShell>
  );
}
