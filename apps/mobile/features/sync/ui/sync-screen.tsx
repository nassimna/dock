import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { SYNC_ENDPOINT } from "@/lib/env";
import { useDock } from "@/lib/use-dock";
import {
  authenticate,
  disconnectSync,
  syncFeature,
  syncFeatures,
  syncNow,
  syncStatus,
} from "@/lib/sync";
import { commandSchema } from "@dock/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

export function SyncScreen() {
  const { t } = useTranslation();
  useDock();
  const query = useQuery({
    queryKey: ["sync"],
    queryFn: () => ({ status: syncStatus(), features: syncFeatures() }),
    networkMode: "always",
  });
  const status = query.data?.status;
  const features = query.data?.features;
  const [endpoint, setEndpoint] = useState(SYNC_ENDPOINT);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");
  const [showLogin, setShowLogin] = useState(false);
  const action = useMutation({
    mutationFn: async (run: () => Promise<unknown>) => run(),
  });
  const login = () =>
    action.mutate(async () => {
      const parsed = commandSchema.parse(
        mode === "recover"
          ? {
              type: "sync.recover",
              endpoint: status?.endpoint || endpoint,
              email,
              password,
              recoveryCode,
            }
          : {
              type: mode === "signup" ? "sync.signup" : "sync.login",
              endpoint: status?.endpoint || endpoint,
              email,
              password,
              inviteCode,
            },
      );
      if (parsed.type === "sync.recover") await syncFeature(parsed);
      else if (parsed.type === "sync.login" || parsed.type === "sync.signup")
        await authenticate(parsed);
      setPassword("");
      setInviteCode("");
      setRecoveryCode("");
      setShowLogin(false);
    });
  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-row items-center justify-between border-b border-border p-3">
        <Button
          variant="ghost"
          label={t("common.cancel")}
          onPress={() => router.back()}
        />
        <Text variant="heading">{t("production.sync")}</Text>
      </View>
      <KeyboardAwareScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        <View className="gap-2 rounded-md border border-border bg-card p-4">
          <Text variant="heading">
            {status?.connected
              ? status.email
              : t("production.syncDisconnected")}
          </Text>
          {!!status?.endpoint && <Text variant="muted">{status.endpoint}</Text>}
          {status?.connected && (
            <>
              <Text>{t(`syncState.${status.phase}`)}</Text>
              <Text variant="muted">
                {t("production.pending")}: {status.pending} ·{" "}
                {t("production.conflicts")}: {status.conflicts}
              </Text>
              <Button
                loading={action.isPending}
                label={t("production.syncNow")}
                onPress={() => action.mutate(syncNow)}
              />
              <Button
                variant="outline"
                label={t("production.login")}
                onPress={() => setShowLogin(!showLogin)}
              />
              <Button
                variant="outline"
                label={t("production.disconnect")}
                onPress={() => action.mutate(disconnectSync)}
              />
            </>
          )}
          {!!status?.error && (
            <Text accessibilityRole="alert" className="text-destructive">
              {status.error}
            </Text>
          )}
        </View>
        <Button
          variant="outline"
          label={t("production.resolveConflicts")}
          onPress={() => router.push("/conflicts")}
        />
        {(!status?.connected || showLogin) && (
          <View className="gap-3">
            <Text variant="label">{t("production.server")}</Text>
            <Input
              accessibilityLabel={t("production.server")}
              value={status?.endpoint || endpoint}
              editable={!status?.endpoint}
              onChangeText={setEndpoint}
              autoCapitalize="none"
              keyboardType="url"
            />
            <Input
              accessibilityLabel={t("production.email")}
              placeholder={t("production.email")}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Input
              accessibilityLabel={t("production.password")}
              placeholder={t("production.password")}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
            {mode === "signup" && (
              <Input
                accessibilityLabel={t("production.invite")}
                placeholder={t("production.invite")}
                value={inviteCode}
                onChangeText={setInviteCode}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            {mode === "recover" && (
              <Input
                accessibilityLabel={t("production.recovery")}
                placeholder={t("production.recovery")}
                value={recoveryCode}
                onChangeText={setRecoveryCode}
                autoCapitalize="none"
                autoCorrect={false}
              />
            )}
            <Button
              label={t(
                mode === "signup"
                  ? "production.signup"
                  : mode === "recover"
                    ? "production.recover"
                    : "production.login",
              )}
              loading={action.isPending}
              disabled={!email.trim() || password.length < 12}
              onPress={login}
            />
            <Button
              variant="ghost"
              label={t(
                mode === "signup" ? "production.login" : "production.signup",
              )}
              onPress={() => setMode(mode === "signup" ? "login" : "signup")}
            />
            <Button
              variant="ghost"
              label={t("production.recover")}
              onPress={() => setMode("recover")}
            />
          </View>
        )}
        {status?.connected && (
          <>
            <View className="gap-3">
              <Text variant="heading">{t("production.recovery")}</Text>
              <Text variant="muted">{t("production.recoveryWarning")}</Text>
              <Button
                variant="outline"
                label={t("production.generateRecovery")}
                loading={action.isPending}
                onPress={() =>
                  action.mutate(() =>
                    syncFeature({ type: "sync.recovery.create" }),
                  )
                }
              />
              {!!features?.recoveryCode && (
                <Text selectable>{features.recoveryCode}</Text>
              )}
            </View>
            <View className="gap-3">
              <Text variant="heading">{t("production.devices")}</Text>
              <Button
                variant="outline"
                label={t("production.devices")}
                onPress={() =>
                  action.mutate(() => syncFeature({ type: "sync.devices" }))
                }
              />
              {features?.devices.map((device) => (
                <View
                  key={device.id}
                  className="gap-2 rounded-md border border-border p-3"
                >
                  <Text>{device.name}</Text>
                  <Text variant="muted">{device.expiresAt.slice(0, 10)}</Text>
                  {!device.current && (
                    <Button
                      variant="outline"
                      label={t("production.revoke")}
                      onPress={() =>
                        action.mutate(() =>
                          syncFeature({
                            type: "sync.device.revoke",
                            id: device.id,
                          }),
                        )
                      }
                    />
                  )}
                </View>
              ))}
            </View>
          </>
        )}
        {action.isError && (
          <Text accessibilityRole="alert" className="text-destructive">
            {action.error.message}
          </Text>
        )}
      </KeyboardAwareScrollView>
    </SafeAreaView>
  );
}
