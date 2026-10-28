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
  disabled = false,
  selected,
  onSelect,
}: {
  item: Item;
  onToggle: () => void;
  disabled?: boolean;
  selected?: boolean;
  onSelect?: () => void;
}) {
  const { t } = useTranslation();
  const { density } = useTheme();
  return (
    <View className="flex-row items-start rounded-md border border-border bg-card">
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
          className="min-h-16 w-14 items-center justify-center"
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
          "min-h-16 flex-1 gap-1 pe-4",
          density === "comfortable" ? "py-5" : "py-3",
          item.kind === "note" && "ps-4",
        )}
      >
        <Text
          className={cn(
            "font-medium",
            item.done && "text-muted-foreground line-through",
          )}
        >
          {item.title}
        </Text>
        {!!item.body && (
          <Text variant="muted" numberOfLines={2}>
            {item.body.replace(/<[^>]*>/g, " ")}
          </Text>
        )}
        <View className="flex-row flex-wrap items-center gap-3">
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
