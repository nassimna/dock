import { projectSchema, type Project, type Workspace } from "@dock/contracts";
import { getDatabase } from "@/lib/database";
import { execute } from "@/lib/actions";

export function saveWorkspace(workspace: Workspace) {
  return execute({ type: "workspace.save", workspace });
}
export function saveProject(input: Project, expected?: Project) {
  const project = projectSchema.parse(input);
  const workspace = getDatabase().workspace();
  if (
    expected &&
    JSON.stringify(
      workspace.projects.find((value) => value.id === expected.id),
    ) !== JSON.stringify(expected)
  )
    throw new Error("This project changed. Reopen it before saving.");
  return saveWorkspace({
    ...workspace,
    projects: workspace.projects.some((value) => value.id === project.id)
      ? workspace.projects.map((value) =>
          value.id === project.id ? project : value,
        )
      : [...workspace.projects, project],
  });
}
export function removeProject(id: string) {
  const snapshot = getDatabase().snapshot();
  const ids = snapshot.items
    .filter(
      (item) =>
        item.kind === "task" &&
        item.task.projectId === id &&
        !item.task.parentId,
    )
    .map((item) => item.id);
  if (ids.length)
    execute({
      type: "item.bulk",
      ids,
      action: "update",
      patch: { task: { projectId: null, sectionId: null } },
    });
  const workspace = getDatabase().workspace();
  return saveWorkspace({
    ...workspace,
    projects: workspace.projects
      .filter((value) => value.id !== id)
      .map((value) =>
        value.parentId === id ? { ...value, parentId: null } : value,
      ),
  });
}
