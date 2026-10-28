import { useMutation } from "@tanstack/react-query";
import { saveItem, setTaskDone } from "../api/items";

export function useSaveItem() {
  return useMutation({
    mutationFn: async (input: Parameters<typeof saveItem>[0]) =>
      saveItem(input),
  });
}

export function useSetTaskDone() {
  return useMutation({
    mutationFn: async (input: Parameters<typeof setTaskDone>[0]) =>
      setTaskDone(input),
  });
}
