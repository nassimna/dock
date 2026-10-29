import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Icon } from "./icon";
import { Button } from "./button";
import { Text } from "./text";

export function DateTimeField({
  label,
  value,
  onChange,
  presentation = "field",
}: {
  presentation?: "field" | "property";
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const { t } = useTranslation();
  return (
    <View
      className={
        presentation === "property"
          ? "min-h-12 flex-row items-center gap-2"
          : "gap-2"
      }
    >
      {presentation === "property" ? (
        <View className="w-24 flex-row items-center gap-2">
          <Icon
            name="calendar-outline"
            size={15}
            className="text-muted-foreground"
          />
          <Text variant="muted" className="shrink text-xs">
            {label}
          </Text>
        </View>
      ) : (
        <Text variant="label">{label}</Text>
      )}
      <View
        className={
          presentation === "property"
            ? "min-w-0 flex-1 flex-row items-center gap-1"
            : "flex-row gap-2"
        }
      >
        <Button
          className={
            presentation === "property"
              ? "min-w-0 flex-1 justify-start px-0"
              : "flex-1"
          }
          size={presentation === "property" ? "sm" : "default"}
          variant={presentation === "property" ? "ghost" : "outline"}
          icon={presentation === "property" ? undefined : "calendar-outline"}
          label={
            value ? dayjs(value).format("D MMM YYYY") : t("items.unscheduled")
          }
          onPress={() => setMode("date")}
        />
        {value && (
          <>
            <Button
              variant={presentation === "property" ? "ghost" : "outline"}
              size={presentation === "property" ? "sm" : "default"}
              className={presentation === "property" ? "px-1" : undefined}
              label={dayjs(value).format("HH:mm")}
              onPress={() => setMode("time")}
            />
            <Button
              variant="ghost"
              className={presentation === "property" ? "w-11" : undefined}
              icon="close"
              iconOnly
              label={t("production.clear")}
              onPress={() => onChange(null)}
            />
          </>
        )}
      </View>
      {mode && (
        <DateTimePicker
          value={dayjs(value ?? undefined).toDate()}
          mode={mode}
          is24Hour
          onChange={(event, date) => {
            setMode(null);
            if (event.type !== "set" || !date) return;
            const current = dayjs(value ?? undefined);
            onChange(
              (mode === "date"
                ? dayjs(date)
                    .hour(value ? current.hour() : 23)
                    .minute(value ? current.minute() : 59)
                : current.hour(dayjs(date).hour()).minute(dayjs(date).minute())
              )
                .second(0)
                .millisecond(0)
                .toISOString(),
            );
          }}
        />
      )}
    </View>
  );
}
