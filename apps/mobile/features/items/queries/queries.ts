import { useQuery } from "@tanstack/react-query";
import { getSnapshot } from "@/lib/database";
import { itemKeys } from "./keys";

export function useDockQuery() {
  return useQuery({
    queryKey: itemKeys.all,
    queryFn: getSnapshot,
    networkMode: "always",
  });
}
