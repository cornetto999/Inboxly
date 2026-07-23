import { useCallback } from "react";
import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  EMPTY_EMAIL_FOLDER_COUNTS,
  getEmailFolderCounts,
  type EmailFolderCounts,
} from "@/lib/crm.functions";

type EmailFolderCountsUpdate =
  | Partial<EmailFolderCounts>
  | ((
      current: EmailFolderCounts,
    ) => Partial<EmailFolderCounts> | EmailFolderCounts);

export function getEmailFolderCountsQueryKey(emailAccountId?: string) {
  return ["email-folder-counts", emailAccountId ?? "all"] as const;
}

function normalizeEmailFolderCounts(
  counts: Partial<EmailFolderCounts>,
): EmailFolderCounts {
  return {
    all: Math.max(0, counts.all ?? 0),
    unread: Math.max(0, counts.unread ?? 0),
    read: Math.max(0, counts.read ?? 0),
    starred: Math.max(0, counts.starred ?? 0),
    replied: Math.max(0, counts.replied ?? 0),
    sent: Math.max(0, counts.sent ?? 0),
    drafts: Math.max(0, counts.drafts ?? 0),
    archived: Math.max(0, counts.archived ?? 0),
    spam: Math.max(0, counts.spam ?? 0),
    trash: Math.max(0, counts.trash ?? 0),
  };
}

export function useEmailFolderCounts(emailAccountId?: string) {
  const queryClient = useQueryClient();
  const getCounts = useServerFn(getEmailFolderCounts);
  const queryKey = getEmailFolderCountsQueryKey(emailAccountId);

  const query = useQuery({
    queryKey,
    queryFn: () =>
      getCounts({
        data: emailAccountId ? { accountId: emailAccountId } : {},
      }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
    gcTime: 10 * 60_000,
    refetchInterval: 30_000,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
  });

  const refreshCounts = useCallback(() => {
    return queryClient.invalidateQueries({ queryKey });
  }, [queryClient, queryKey]);

  const updateCountOptimistically = useCallback(
    (update: EmailFolderCountsUpdate) => {
      const previous =
        queryClient.getQueryData<EmailFolderCounts>(queryKey) ??
        EMPTY_EMAIL_FOLDER_COUNTS;
      const patch = typeof update === "function" ? update(previous) : update;
      const next = normalizeEmailFolderCounts({ ...previous, ...patch });

      queryClient.setQueryData(queryKey, next);
      return previous;
    },
    [queryClient, queryKey],
  );

  return {
    counts: normalizeEmailFolderCounts(query.data ?? EMPTY_EMAIL_FOLDER_COUNTS),
    isLoading: query.isPending && !query.data,
    error: query.error,
    refreshCounts,
    updateCountOptimistically,
  };
}
