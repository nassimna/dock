import { useRef, useState } from "react";
import { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useTranslation } from "react-i18next";
import { Keyboard, Modal, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./button";
import { Icon, type IconName } from "./icon";
import { Text } from "./text";
import { Sheet } from "./sheet";

export function Select({
  label,
  value,
  options,
  onChange,
  presentation = "field",
  icon,
}: {
  presentation?: "field" | "property";
  icon?: IconName;
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sheet = useRef<BottomSheetModal>(null);
  const { t } = useTranslation();
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? value;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => {
          if (presentation === "property") {
            Keyboard.dismiss();
            sheet.current?.present();
          } else setOpen(true);
        }}
        className={
          presentation === "property"
            ? "min-h-12 flex-row items-center gap-2 py-1"
            : "min-h-12 flex-row items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-3"
        }
      >
        {presentation === "property" ? (
          <>
            <View className="w-24 flex-row items-center gap-2">
              {icon && (
                <Icon name={icon} size={15} className="text-muted-foreground" />
              )}
              <Text variant="muted" className="shrink text-xs">
                {label}
              </Text>
            </View>
            <Text className="flex-1 text-sm">{selectedLabel}</Text>
          </>
        ) : (
          <View className="flex-1 gap-1">
            <Text variant="muted">{label}</Text>
            <Text>{selectedLabel}</Text>
          </View>
        )}
        <Icon
          name="chevron-down"
          size={presentation === "property" ? 14 : undefined}
          className="text-muted-foreground"
        />
      </Pressable>
      {presentation === "property" ? (
        <Sheet sheetRef={sheet} title={label}>
          {options.map((option) => (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: option.value === value }}
              onPress={() => {
                onChange(option.value);
                sheet.current?.dismiss();
              }}
              className="min-h-14 flex-row items-center gap-3 border-b border-border py-4"
            >
              <Text className="flex-1">{option.label}</Text>
              {option.value === value && (
                <Icon name="checkmark" className="text-primary" />
              )}
            </Pressable>
          ))}
        </Sheet>
      ) : (
        <Modal
          visible={open}
          animationType="slide"
          onRequestClose={() => setOpen(false)}
        >
          <SafeAreaView className="flex-1 bg-background">
            <View className="flex-row items-center justify-between border-b border-border p-3">
              <Text variant="heading">{label}</Text>
              <Button
                variant="ghost"
                label={t("common.cancel")}
                onPress={() => setOpen(false)}
              />
            </View>
            <FlatList
              data={options}
              keyExtractor={(option) => option.value}
              renderItem={({ item }) => (
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ checked: item.value === value }}
                  onPress={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                  className="min-h-14 flex-row items-center justify-between border-b border-border px-5 py-4"
                >
                  <Text className="flex-1">{item.label}</Text>
                  {item.value === value && (
                    <Icon name="checkmark" className="text-primary" />
                  )}
                </Pressable>
              )}
            />
          </SafeAreaView>
        </Modal>
      )}
    </>
  );
}
