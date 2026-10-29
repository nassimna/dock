import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Text } from "@/components/ui/text";
import { SYNC_ENDPOINT } from "@/lib/env";
import { useDock } from "@/lib/use-dock";
import { authenticate, disconnectSync, syncFeature, syncFeatures, syncNow, syncStatus } from "@/lib/sync";
import { appBrand, commandSchema } from "@dock/contracts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, BackHandler, type TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

export function SyncScreen() {
  const { t, i18n } = useTranslation();
  useDock();
  const query = useQuery({ queryKey: ["sync"], queryFn: () => ({ status: syncStatus(), features: syncFeatures() }), networkMode: "always" });
  const status = query.data?.status;
  const features = query.data?.features;
  const [endpoint, setEndpoint] = useState<string>(SYNC_ENDPOINT);
  const [email, setEmail] = useState(syncStatus().email);
  const [password, setPassword] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [mode, setMode] = useState<"login" | "signup" | "recover">("login");
  const [page, setPage] = useState<"overview" | "security" | "devices">("overview");
  const [advanced, setAdvanced] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const [reveal, setReveal] = useState(false);
  const [validation, setValidation] = useState("");
  const passwordInput = useRef<TextInput>(null);
  const codeInput = useRef<TextInput>(null);
  const pending = useRef(false);
  const action = useMutation({ mutationFn: async (operation: () => Promise<unknown>) => { try { return await operation(); } finally { pending.current = false; } } });
  function run(operation: () => Promise<unknown>) {
    if (pending.current) return;
    pending.current = true;
    setValidation("");
    action.mutate(operation);
  }
  function changeMode(next: typeof mode) {
    setMode(next); setPassword(""); setRecoveryCode(""); setReveal(false); setValidation(""); action.reset();
  }
  function login() {
    if (pending.current) return;
    const parsed = commandSchema.safeParse({ type: mode === "recover" ? "sync.recover" : mode === "signup" ? "sync.signup" : "sync.login", endpoint: status?.endpoint || endpoint, email, password, recoveryCode: recoveryCode.trim() });
    if (!parsed.success) {
      action.reset();
      const field = parsed.error.issues[0]?.path[0];
      setValidation(t(field === "email" ? "account.emailError" : field === "password" ? "account.passwordError" : field === "recoveryCode" ? "account.codeError" : "account.serverError"));
      return;
    }
    run(async () => {
      if (parsed.data.type === "sync.recover") await syncFeature(parsed.data);
      else if (parsed.data.type === "sync.login" || parsed.data.type === "sync.signup") await authenticate(parsed.data);
      setPassword(""); setReveal(false); setRecoveryCode(""); setShowLogin(false);
      setPage(mode === "login" ? "overview" : "security"); setMode("login");
    });
  }
  function signOut() {
    Alert.alert(t("account.signOutQuestion"), t("account.signOutHint"), [
      { text: t("account.stay"), style: "cancel" },
      { text: t("account.signOut"), style: "destructive", onPress: () => run(async () => { await disconnectSync(); setPage("overview"); changeMode("login"); }) },
    ]);
  }
  const authenticating = !status?.connected || showLogin;
  const back = useCallback(() => {
    if (action.isPending) return;
    setValidation(""); action.reset(); setPassword(""); setRecoveryCode(""); setReveal(false);
    if (authenticating && mode !== "login") setMode("login");
    else if (showLogin || page !== "overview") { setShowLogin(false); setPage("overview"); }
    else router.back();
  }, [action.isPending, action.reset, authenticating, mode, showLogin, page]);
  useFocusEffect(useCallback(() => {
    if (page === "overview" && !showLogin && mode === "login" && !action.isPending) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => { back(); return true; });
    return () => subscription.remove();
  }, [page, showLogin, mode, action.isPending, back]));
  const title = authenticating ? mode === "signup" ? "account.createTitle" : mode === "recover" ? "account.resetTitle" : "account.welcome" : page === "security" ? "account.security" : page === "devices" ? "account.deviceTitle" : "account.title";
  const message = validation || (action.error ? t(({
    "Email or password is incorrect.": "account.credentialsError",
    "Unable to create this account. Try signing in.": "account.existsError",
    "Too many sign-in attempts. Try again in a minute.": "account.rateError",
    "Could not reach the sync server. Check your connection and try again.": "account.networkError",
    "Could not reach the sync server.": "account.networkError",
    "The sync server took too long to respond. Try again.": "account.timeoutError",
    "Email or recovery code is incorrect.": "account.recoveryError",
    "Too many recovery attempts. Try again in a minute.": "account.recoveryRateError",
    "The recovery code was already used. Try your latest code.": "account.usedCodeError",
  } as Record<string, string>)[action.error.message] || action.error.message) : "");
  return <SafeAreaView className="flex-1 bg-background">
    <View className="flex-row items-center justify-between border-b border-border px-3 py-2">
      <Button variant="ghost" icon={i18n.dir() === "rtl" ? "arrow-forward-outline" : "arrow-back-outline"} label={t("account.back")} disabled={action.isPending} onPress={back} />
      <Text className="font-semibold text-primary">{i18n.language === "ar" ? appBrand.arabicName : appBrand.name}</Text>
    </View>
    <KeyboardAwareScrollView key={`${authenticating}-${page}`} keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 24, gap: 24 }}>
      <View className="gap-3 pt-3">
        <Icon name={authenticating ? "person-circle-outline" : page === "security" ? "shield-checkmark-outline" : page === "devices" ? "phone-portrait-outline" : "cloud-done-outline"} size={40} className="text-primary" />
        <Text className="text-3xl font-semibold">{t(title)}</Text>
        <Text variant="muted" className="leading-6">{authenticating ? t(mode === "recover" ? "account.resetHint" : "account.subtitle") : status?.email}</Text>
      </View>
      {authenticating ? <View className="gap-5">
        <View className="gap-2"><Text variant="label">{t("account.email")}</Text>
          <Input accessibilityLabel={t("account.email")} placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="username" returnKeyType="next" submitBehavior="submit" onSubmitEditing={() => passwordInput.current?.focus()} editable={!action.isPending} style={{ textAlign: "left", writingDirection: "ltr" }} />
        </View>
        <View className="gap-2"><Text variant="label">{t(mode === "recover" ? "account.newPassword" : "account.password")}</Text>
          <View className="flex-row items-center gap-2"><Input ref={passwordInput} accessibilityLabel={t("account.password")} className="flex-1" value={password} onChangeText={setPassword} secureTextEntry={!reveal} autoCapitalize="none" autoCorrect={false} maxLength={128} autoComplete={mode === "login" ? "current-password" : "new-password"} textContentType={mode === "login" ? "password" : "newPassword"} returnKeyType={mode === "recover" ? "next" : "go"} submitBehavior="submit" onSubmitEditing={() => mode === "recover" ? codeInput.current?.focus() : login()} editable={!action.isPending} style={{ textAlign: "left", writingDirection: "ltr" }} />
            <Button variant="outline" iconOnly icon={reveal ? "eye-off-outline" : "eye-outline"} label={t(reveal ? "account.hide" : "account.show")} disabled={action.isPending} onPress={() => setReveal(!reveal)} /></View>
          {mode === "login" && <Button variant="ghost" className="self-end" label={t("account.forgot")} disabled={action.isPending} onPress={() => changeMode("recover")} />}
          {mode !== "login" && <Text variant="muted">{t("account.passwordHint")}</Text>}
        </View>
        {mode === "recover" && <View className="gap-2"><Text variant="label">{t("production.recovery")}</Text><Input ref={codeInput} accessibilityLabel={t("production.recovery")} value={recoveryCode} onChangeText={setRecoveryCode} editable={!action.isPending} autoCapitalize="none" autoCorrect={false} autoComplete="off" returnKeyType="go" onSubmitEditing={login} style={{ textAlign: "left", writingDirection: "ltr" }} /></View>}
        {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" className="rounded-md border border-destructive p-3 text-destructive">{message}</Text>}
        <Button label={t(mode === "signup" ? "account.create" : mode === "recover" ? "account.reset" : "account.signIn")} loading={action.isPending} onPress={login} />
        <View className="items-center gap-1"><Text variant="muted">{t(mode === "login" ? "account.newHere" : "account.already")}</Text><Button variant="ghost" label={t(mode === "login" ? "account.create" : "account.signIn")} disabled={action.isPending} onPress={() => changeMode(mode === "login" ? "signup" : "login")} /></View>
        <Button variant="ghost" label={t("account.server")} icon={advanced ? "chevron-up-outline" : "chevron-down-outline"} disabled={action.isPending} accessibilityState={{ expanded: advanced }} onPress={() => setAdvanced(!advanced)} />
        {advanced && <View className="gap-2"><Text variant="label">{t("production.server")}</Text><Input accessibilityLabel={t("production.server")} value={status?.endpoint || endpoint} editable={!status?.endpoint && !action.isPending} onChangeText={setEndpoint} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={{ textAlign: "left", writingDirection: "ltr" }} /></View>}
        <Text variant="muted" className="leading-6">{t("account.privacy")}</Text>
      </View> : <View className="gap-5">
        {page === "overview" && <>
          <View className="gap-3 rounded-md border border-border bg-card p-5"><Text variant="heading">{t(`syncState.${status?.phase}`)}</Text>
            {!!status?.pending && <Text variant="muted">{t("account.pending", { count: status.pending })}</Text>}
            {!!status?.lastSyncedAt && <Text variant="muted">{t("account.lastSync", { date: new Date(status.lastSyncedAt).toLocaleString(i18n.language) })}</Text>}
            {!!status?.error && <Text accessibilityRole="alert" className="text-destructive">{status.error}</Text>}
            <Button label={t("production.syncNow")} loading={action.isPending} disabled={status?.phase === "syncing"} onPress={() => run(syncNow)} />
            {(status?.phase === "error" || status?.phase === "offline") && <Button variant="outline" label={t("account.signInAgain")} disabled={action.isPending} onPress={() => { changeMode("login"); setShowLogin(true); }} />}
          </View>
          {!!status?.conflicts && <Button variant="outline" label={t("production.conflictsCount", { count: status.conflicts })} onPress={() => router.push("/conflicts")} />}
          <Button variant="outline" icon="shield-checkmark-outline" label={t("account.security")} disabled={action.isPending} onPress={() => { action.reset(); setPage("security"); }} />
          <Button variant="outline" icon="phone-portrait-outline" label={t("account.deviceTitle")} disabled={action.isPending} onPress={() => { setPage("devices"); run(() => syncFeature({ type: "sync.devices" })); }} />
          <View className="gap-3 border-t border-border pt-5"><Text variant="muted" className="leading-6">{t("account.signOutHint")}</Text><Button variant="ghost" label={t("account.signOut")} disabled={action.isPending} onPress={signOut} /></View>
        </>}
        {page === "security" && <>
          {!!features?.recoveryCode && <View className="gap-3 rounded-md border border-primary bg-card p-4"><Text variant="heading">{t("account.savedCode")}</Text><Text selectable style={{ writingDirection: "ltr", textAlign: "left" }}>{features.recoveryCode}</Text><Text variant="muted">{t("account.codeHint")}</Text></View>}
          <Text className="leading-6">{t("account.recoveryHint")}</Text><Button variant="outline" label={t("account.replaceCode")} loading={action.isPending} onPress={() => run(() => syncFeature({ type: "sync.recovery.create" }))} />
        </>}
        {page === "devices" && <>
          <Text variant="muted">{t("account.deviceHint")}</Text><Button variant="outline" label={t("common.retry")} loading={action.isPending} onPress={() => run(() => syncFeature({ type: "sync.devices" }))} />
          {features?.devices.map(device => <View key={device.id} className="gap-3 rounded-md border border-border bg-card p-4"><Text className="font-semibold">{device.name}</Text>{device.current && <Text variant="muted">{t("account.thisDevice")}</Text>}<Text variant="muted">{t("account.expires", { date: new Date(device.expiresAt).toLocaleDateString(i18n.language) })}</Text>{!device.current && <Button variant="outline" label={t("production.revoke")} disabled={action.isPending} onPress={() => run(() => syncFeature({ type: "sync.device.revoke", id: device.id }))} />}</View>)}
          {!action.isPending && !action.isError && !features?.devices.length && <Text variant="muted">{t("account.emptyDevices")}</Text>}
        </>}
        {!!message && <Text accessibilityRole="alert" className="rounded-md border border-destructive p-3 text-destructive">{message}</Text>}
      </View>}
    </KeyboardAwareScrollView>
  </SafeAreaView>;
}
