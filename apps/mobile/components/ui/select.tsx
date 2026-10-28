import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, FlatList, Pressable, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "./button";
import { Icon } from "./icon";
import { Text } from "./text";

export function Select({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: readonly { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation();
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={() => setOpen(true)}
        className="min-h-12 flex-row items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-3"
      >
        <View className="flex-1 gap-1">
          <Text variant="muted">{label}</Text>
          <Text>
            {options.find((option) => option.value === value)?.label ?? value}
          </Text>
        </View>
        <Icon name="chevron-down" className="text-muted-foreground" />
      </Pressable>
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
    </>
  );
}
