import "@formatjs/intl-pluralrules/polyfill-force.js";
import "@formatjs/intl-pluralrules/locale-data/en.js";
import "@formatjs/intl-pluralrules/locale-data/ar.js";
import dayjs from "dayjs";
import "dayjs/locale/ar-tn";
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { storage } from "../storage";
import { en } from "./locales/en";
import { ar } from "./locales/ar";

export type Language = "en" | "ar";
const language =
  storage.getString("preferences.language") === "ar" ? "ar" : "en";

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: language,
  fallbackLng: "en",
  initAsync: false,
  interpolation: { escapeValue: false },
  returnNull: false,
});
dayjs.locale(language === "ar" ? "ar-tn" : "en");

export async function setLanguage(next: Language) {
  storage.set("preferences.language", next);
  dayjs.locale(next === "ar" ? "ar-tn" : "en");
  await i18n.changeLanguage(next);
}

export { i18n };
