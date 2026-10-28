import DateTimePicker from "@react-native-community/datetimepicker";
import dayjs from "dayjs";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { Button } from "./button";
import { Text } from "./text";

export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [mode, setMode] = useState<"date" | "time" | null>(null);
  const { t } = useTranslation();
  return (
    <View className="gap-2">
      <Text variant="label">{label}</Text>
      <View className="flex-row gap-2">
        <Button
          className="flex-1"
          variant="outline"
          icon="calendar-outline"
          label={
            value ? dayjs(value).format("D MMM YYYY") : t("items.unscheduled")
          }
          onPress={() => setMode("date")}
        />
        {value && (
          <>
            <Button
              variant="outline"
              label={dayjs(value).format("HH:mm")}
              onPress={() => setMode("time")}
            />
            <Button
              variant="ghost"
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
