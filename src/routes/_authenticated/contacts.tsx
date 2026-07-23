import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  convertContactToCustomer,
  convertContactToLead,
  deleteContact,
  importContactsFromEmails,
  listContacts,
  upsertContact,
} from "@/lib/crm.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  EmptyState,
  FormPanel,
  PageHeader,
  PageShell,
  ToolbarCard,
} from "@/components/crm-ui";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ContactRound,
  Download,
  Search,
  Trash2,
  UserCheck,
  UserPlus,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  CrmModuleLoading,
  CrmModuleUnavailable,
} from "@/components/crm-module-state";

export const Route = createFileRoute("/_authenticated/contacts")({
  head: () => ({ meta: [{ title: "Contacts - Inboxly" }] }),
  component: ContactsPage,
});

type ContactForm = {
  id?: string;
  email: string;
  full_name: string;
  phone: string;
  company: string;
  job_title: string;
  tags: string;
  notes: string;
};

const emptyForm: ContactForm = {
  email: "",
  full_name: "",
  phone: "",
  company: "",
  job_title: "",
  tags: "",
  notes: "",
};

function ContactsPage() {
  const qc = useQueryClient();
  const listFn = useServerFn(listContacts);
  const saveFn = useServerFn(upsertContact);
  const deleteFn = useServerFn(deleteContact);
  const importFn = useServerFn(importContactsFromEmails);
  const toLeadFn = useServerFn(convertContactToLead);
  const toCustomerFn = useServerFn(convertContactToCustomer);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState<ContactForm>(emptyForm);

  const {
    data: contacts = [],
    isPending: contactsLoading,
    isError: contactsUnavailable,
  } = useQuery({
    queryKey: ["contacts", search],
    queryFn: () => listFn({ data: { search } }),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["contacts"] });
    qc.invalidateQueries({ queryKey: ["sidebar-counters"] });
  };

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...form,
          tags: form.tags
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      setForm(emptyForm);
      toast.success("Contact saved");
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const importContacts = useMutation({
    mutationFn: () => importFn(),
    onSuccess: (result) => {
      toast.success(`Imported ${result.imported} contact(s)`);
      invalidate();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Contact deleted");
      invalidate();
    },
  });

  const convertToLead = useMutation({
    mutationFn: (id: string) => toLeadFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Converted to lead");
      qc.invalidateQueries({ queryKey: ["leads"] });
      invalidate();
    },
  });

  const convertToCustomer = useMutation({
    mutationFn: (id: string) => toCustomerFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Converted to customer");
      qc.invalidateQueries({ queryKey: ["customers"] });
      invalidate();
    },
  });

  const exportCsv = () => {
    const header = ["Name", "Email", "Phone", "Company", "Job title", "Tags"];
    const rows = contacts.map((contact) => [
      contact.full_name ?? "",
      contact.email,
      contact.phone ?? "",
      contact.company ?? "",
      contact.job_title ?? "",
      (contact.tags ?? []).join("|"),
    ]);
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "inboxly-contacts.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (contactsLoading) {
    return <CrmModuleLoading name="contacts" />;
  }

  if (contactsUnavailable) {
    return <CrmModuleUnavailable name="Contacts" />;
  }

  return (
    <PageShell>
      <PageHeader
        title="Contacts"
        description="Centralized senders, leads, and customers."
      >
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => importContacts.mutate()}>
            <Upload className="h-4 w-4" />
            Import from Gmail
          </Button>
          <Button
            variant="outline"
            onClick={exportCsv}
            disabled={contacts.length === 0}
          >
            <Download className="h-4 w-4" />
            Export CSV
          </Button>
        </div>
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <FormPanel
          icon={ContactRound}
          title={form.id ? "Edit contact" : "Add contact"}
          description="Saved directly to Supabase."
        >
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Phone</Label>
            <Input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Company</Label>
            <Input
              value={form.company}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Job title</Label>
            <Input
              value={form.job_title}
              onChange={(e) => setForm({ ...form, job_title: e.target.value })}
            />
          </div>
          <div className="space-y-2">
            <Label>Tags</Label>
            <Input
              value={form.tags}
              onChange={(e) => setForm({ ...form, tags: e.target.value })}
              placeholder="vip, renewal"
            />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </div>
          <div className="flex gap-2">
            <Button
              className="flex-1"
              onClick={() => save.mutate()}
              disabled={!form.email || save.isPending}
            >
              Save
            </Button>
            {form.id && (
              <Button variant="outline" onClick={() => setForm(emptyForm)}>
                Cancel
              </Button>
            )}
          </div>
        </FormPanel>

        <div className="space-y-4">
          <ToolbarCard className="mb-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search contacts"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
          </ToolbarCard>

          {contacts.length === 0 ? (
            <EmptyState
              icon={ContactRound}
              title="No contacts yet"
              description="Import senders or add one manually."
            />
          ) : (
            <div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Contact</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Tags</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <button
                          className="text-left"
                          onClick={() =>
                            setForm({
                              id: contact.id,
                              email: contact.email,
                              full_name: contact.full_name ?? "",
                              phone: contact.phone ?? "",
                              company: contact.company ?? "",
                              job_title: contact.job_title ?? "",
                              tags: (contact.tags ?? []).join(", "),
                              notes: contact.notes ?? "",
                            })
                          }
                        >
                          <div className="font-medium">
                            {contact.full_name || contact.email}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {contact.email}
                          </div>
                        </button>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {contact.company || "Unassigned"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {(contact.tags ?? []).join(", ") || "None"}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Convert to lead"
                            onClick={() => convertToLead.mutate(contact.id)}
                          >
                            <UserPlus className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Convert to customer"
                            onClick={() => convertToCustomer.mutate(contact.id)}
                          >
                            <UserCheck className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Delete"
                            onClick={() => remove.mutate(contact.id)}
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
      </div>
    </PageShell>
  );
}
