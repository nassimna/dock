import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import type { Item } from "@dock/contracts";
import dayjs from "dayjs";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";

const tones = {
  1: "text-destructive",
  2: "text-warning",
  3: "text-info",
  4: "text-muted-foreground",
};
export function ItemRow({
  item,
  onToggle,
  projectName,
  disabled = false,
  selected,
  onSelect,
}: {
  item: Item;
  projectName?: string;
  onToggle: () => void;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { t } = useTranslation();
  const { density } = useTheme();
  return (
    <View className="flex-row items-start bg-background">
      {item.kind === "task" && (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: selected ?? item.done, disabled }}
          accessibilityLabel={
            onSelect
              ? t("production.selectTask", { title: item.title })
              : t(item.done ? "items.reopen" : "items.complete", {
                  title: item.title,
                })
          }
          disabled={disabled}
          onPress={onSelect ?? onToggle}
          className="min-h-14 w-11 items-center justify-center"
        >
          <Icon
            name={(selected ?? item.done) ? "checkbox" : "square-outline"}
            className={item.done ? "text-primary" : tones[item.task.priority]}
            size={24}
          />
        </Pressable>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("common.edit", { title: item.title })}
        onPress={
          onSelect ??
          (() => router.push({ pathname: "/capture", params: { id: item.id } }))
        }
        className={cn(
          "min-h-14 flex-1 gap-1 pe-2",
          density === "comfortable" ? "py-3" : "py-2",
          item.kind === "note" && "ps-4",
        )}
      >
        <Text
          className={cn(
            "text-sm font-medium",
            item.done && "text-muted-foreground line-through",
          )}
        >
          {item.title}
        </Text>
        {!!item.body && (
          <Text variant="muted" numberOfLines={1}>
            {item.body.replace(/<[^>]*>/g, " ")}
          </Text>
        )}
        <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          {!!projectName && (
            <View className="max-w-full flex-row items-center gap-1">
              <Icon
                name="folder-outline"
                size={12}
                className="text-muted-foreground"
              />
              <Text
                numberOfLines={1}
                className="shrink text-xs text-muted-foreground"
              >
                {projectName}
              </Text>
            </View>
          )}
          {item.kind === "task" && (
            <Text className={cn("text-xs", tones[item.task.priority])}>
              P{item.task.priority}
            </Text>
          )}
          {item.scheduledAt && (
            <Text
              className={cn(
                "text-xs text-muted-foreground",
                dayjs(item.scheduledAt).isBefore(dayjs(), "day") &&
                  !item.done &&
                  "text-destructive",
              )}
            >
              {dayjs(item.scheduledAt).format("D MMM · HH:mm")}
            </Text>
          )}
          {item.tags.map((tag) => (
            <Text key={tag} className="text-xs text-muted-foreground">
              #{tag}
            </Text>
          ))}
        </View>
      </Pressable>
    </View>
  );
}
