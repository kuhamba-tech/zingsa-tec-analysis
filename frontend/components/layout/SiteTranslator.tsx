"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type TranslateWindow = Window & {
  google?: {
    translate?: {
      TranslateElement?: new (
        options: { pageLanguage: string; includedLanguages?: string; autoDisplay?: boolean },
        containerId: string,
      ) => void;
    };
  };
  googleTranslateElementInit?: () => void;
};

type LanguageOption = {
  id: string;
  translateCode: string;
  short: string;
  name: string;
  native: string;
  group: "Zimbabwe Languages" | "UN Official Languages" | "More Languages";
};

const LANGUAGES: LanguageOption[] = [
  { id: "ny", translateCode: "ny", short: "MW", name: "Chewa", native: "Chichewa", group: "Zimbabwe Languages" },
  { id: "chibarwe", translateCode: "sn", short: "ZW", name: "Chibarwe", native: "Chibarwe", group: "Zimbabwe Languages" },
  { id: "en", translateCode: "en", short: "GB", name: "English", native: "", group: "Zimbabwe Languages" },
  { id: "kalanga", translateCode: "sn", short: "ZW", name: "Kalanga", native: "TjiKalanga", group: "Zimbabwe Languages" },
  { id: "koisan", translateCode: "af", short: "ZW", name: "Koisan", native: "Koisan", group: "Zimbabwe Languages" },
  { id: "nambya", translateCode: "sn", short: "ZW", name: "Nambya", native: "Nambya", group: "Zimbabwe Languages" },
  { id: "ndau", translateCode: "sn", short: "ZW", name: "Ndau", native: "ChiNdau", group: "Zimbabwe Languages" },
  { id: "nr", translateCode: "nr", short: "ZW", name: "Ndebele", native: "isiNdebele", group: "Zimbabwe Languages" },
  { id: "ts", translateCode: "ts", short: "ZW", name: "Shangani", native: "xiShangani", group: "Zimbabwe Languages" },
  { id: "sn", translateCode: "sn", short: "ZW", name: "Shona", native: "ChiShona", group: "Zimbabwe Languages" },
  { id: "sign", translateCode: "en", short: "ZW", name: "Sign Language", native: "Zimbabwe Sign Language", group: "Zimbabwe Languages" },
  { id: "st", translateCode: "st", short: "LS", name: "Sotho", native: "Sesotho", group: "Zimbabwe Languages" },
  { id: "tonga", translateCode: "ny", short: "ZW", name: "Tonga", native: "ChiTonga", group: "Zimbabwe Languages" },
  { id: "tn", translateCode: "tn", short: "BW", name: "Tswana", native: "Setswana", group: "Zimbabwe Languages" },
  { id: "ve", translateCode: "ve", short: "ZA", name: "Venda", native: "Tshivenda", group: "Zimbabwe Languages" },
  { id: "xh", translateCode: "xh", short: "ZA", name: "Xhosa", native: "isiXhosa", group: "Zimbabwe Languages" },
  { id: "ar", translateCode: "ar", short: "SA", name: "Arabic", native: "Arabic", group: "UN Official Languages" },
  { id: "zh-CN", translateCode: "zh-CN", short: "CN", name: "Chinese", native: "Chinese", group: "UN Official Languages" },
  { id: "fr", translateCode: "fr", short: "FR", name: "French", native: "Francais", group: "UN Official Languages" },
  { id: "ru", translateCode: "ru", short: "RU", name: "Russian", native: "Russkiy", group: "UN Official Languages" },
  { id: "es", translateCode: "es", short: "ES", name: "Spanish", native: "Espanol", group: "UN Official Languages" },
  { id: "pt", translateCode: "pt", short: "MZ", name: "Portuguese", native: "Portugues", group: "More Languages" },
  { id: "de", translateCode: "de", short: "DE", name: "German", native: "Deutsch", group: "More Languages" },
  { id: "ja", translateCode: "ja", short: "JP", name: "Japanese", native: "Nihongo", group: "More Languages" },
  { id: "hi", translateCode: "hi", short: "IN", name: "Hindi", native: "Hindi", group: "More Languages" },
];

const GROUPS: LanguageOption["group"][] = [
  "Zimbabwe Languages",
  "UN Official Languages",
  "More Languages",
];

const SUPPORTED_TRANSLATE_CODES = Array.from(new Set(LANGUAGES.map((language) => language.translateCode)));

function setTranslateCookie(language: string) {
  const value = language === "en" ? "/en/en" : `/en/${language}`;
  const expires = "expires=Fri, 31 Dec 9999 23:59:59 GMT";
  document.cookie = `googtrans=${value}; ${expires}; path=/`;
  document.cookie = `googtrans=${value}; ${expires}; path=/; domain=${window.location.hostname}`;
}

function currentLanguageFromCookie() {
  if (typeof document === "undefined") return "en";
  const match = document.cookie.match(/(?:^|;\s*)googtrans=([^;]+)/);
  const value = match ? decodeURIComponent(match[1]) : "";
  return value.split("/").filter(Boolean).at(-1) || "en";
}

function currentLanguageIdFromStorage() {
  if (typeof window === "undefined") return "en";
  return window.localStorage.getItem("zgiis_translator_language_id") || currentLanguageFromCookie();
}

export default function SiteTranslator() {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState("en");
  const panelRef = useRef<HTMLDivElement | null>(null);
  const includedLanguages = useMemo(() => SUPPORTED_TRANSLATE_CODES.join(","), []);

  useEffect(() => {
    setActive(currentLanguageIdFromStorage());
  }, []);

  useEffect(() => {
    const w = window as TranslateWindow;
    w.googleTranslateElementInit = () => {
      const TranslateElement = w.google?.translate?.TranslateElement;
      if (TranslateElement) {
        new TranslateElement(
          { pageLanguage: "en", includedLanguages, autoDisplay: false },
          "google_translate_element",
        );
      }
    };

    if (!document.querySelector('script[src*="translate.google.com/translate_a/element.js"]')) {
      const script = document.createElement("script");
      script.src = "//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      script.async = true;
      document.body.appendChild(script);
    } else {
      w.googleTranslateElementInit?.();
    }
  }, [includedLanguages]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (panelRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    if (open) document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const applyLanguage = (language: LanguageOption) => {
    setActive(language.id);
    window.localStorage.setItem("zgiis_translator_language_id", language.id);
    setTranslateCookie(language.translateCode);
    const select = document.querySelector<HTMLSelectElement>(".goog-te-combo");
    if (select) {
      select.value = language.translateCode === "en" ? "" : language.translateCode;
      select.dispatchEvent(new Event("change"));
    }
    window.setTimeout(() => window.location.reload(), 150);
  };

  return (
    <div className="site-translator" ref={panelRef}>
      <button
        type="button"
        className="site-translator-trigger"
        aria-label={open ? "Close translator" : "Translate this site"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden>A</span>
      </button>

      {open && (
        <div className="site-translator-panel" role="dialog" aria-label="Translate this site">
          <div className="site-translator-head">
            <div className="site-translator-icon" aria-hidden>A</div>
            <div>
              <div className="site-translator-title">Translate this site</div>
              <div className="site-translator-subtitle">
                Zimbabwe languages + UN languages, Japanese & more
              </div>
            </div>
          </div>

          <div className="site-translator-list">
            {GROUPS.map((group) => (
              <section key={group} className="site-translator-group">
                <div className="site-translator-group-title">{group}</div>
                {LANGUAGES.filter((language) => language.group === group).map((language) => {
                  const selected = active === language.id || (active === "zh" && language.id === "zh-CN");
                  return (
                    <button
                      type="button"
                      key={language.id}
                      className={`site-translator-option${selected ? " is-selected" : ""}`}
                      onClick={() => applyLanguage(language)}
                    >
                      <span className="site-translator-short">{language.short}</span>
                      <span className="site-translator-name-wrap">
                        <span className="site-translator-name">{language.name}</span>
                        {language.native && <span className="site-translator-native">{language.native}</span>}
                      </span>
                      {selected && <span className="site-translator-check" aria-hidden>OK</span>}
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
        </div>
      )}

      <div id="google_translate_element" className="site-translator-google" aria-hidden="true" />
    </div>
  );
}
