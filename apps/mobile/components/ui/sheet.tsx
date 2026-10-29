import { useTheme } from "@/lib/theme";
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { BackHandler, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "./button";
import { Text } from "./text";

export function Sheet({
  sheetRef,
  title,
  children,
}: {
  sheetRef: RefObject<BottomSheetModal | null>;
  title: string;
  children: ReactNode;
}) {
  const { colors } = useTheme();
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      sheetRef.current?.dismiss();
      return true;
    });
    return () => listener.remove();
  }, [open, sheetRef]);
  return (
    <BottomSheetModal
      ref={sheetRef}
      stackBehavior="push"
      enablePanDownToClose
      enableBlurKeyboardOnGesture
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustResize"
      maxDynamicContentSize={height * 0.8}
      backgroundStyle={{ backgroundColor: colors.background }}
      handleIndicatorStyle={{ backgroundColor: colors.mutedForeground }}
      onChange={(index) => setOpen(index >= 0)}
      onDismiss={() => setOpen(false)}
      backdropComponent={(props) => (
        <BottomSheetBackdrop
          {...props}
          appearsOnIndex={0}
          disappearsOnIndex={-1}
        />
      )}
    >
      <BottomSheetScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 24,
          direction: i18n.dir(),
        }}
      >
        <View className="mb-3 flex-row items-center justify-between gap-3">
          <Text accessibilityRole="header" variant="heading" className="flex-1">
            {title}
          </Text>
          <Button
            variant="ghost"
            label={t("capture.done")}
            onPress={() => sheetRef.current?.dismiss()}
          />
        </View>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
}
