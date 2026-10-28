import { useMutation } from "@tanstack/react-query";
import { type DataCommand } from "@dock/contracts";
import { execute } from "./actions";

export { useDockQuery as useDock } from "@/features/items/queries/queries";

export function useCommand() {
  return useMutation({
    mutationFn: async (command: DataCommand) => execute(command),
  });
}
