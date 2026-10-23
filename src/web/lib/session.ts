import { useQuery } from "@tanstack/react-query";
import type { UserRole } from "../../shared/domain";
import { api } from "./api";
import { queryKeys } from "./query-keys";

export interface Me {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
}

/** The signed-in team member. `isOwner` is false until the query loads. */
export function useMe() {
  const query = useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api<{ user: Me }>("/me").then((r) => r.user),
    staleTime: 5 * 60 * 1000,
  });
  return { ...query, me: query.data, isOwner: query.data?.role === "owner" };
}
