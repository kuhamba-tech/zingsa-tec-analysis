"""Translated labels and status summaries for Navigation News delivery."""
from __future__ import annotations

from typing import Any

LABELS: dict[str, dict[str, str]] = {
    "en": {
        "agency": "ZINGSA Navigation News",
        "space_weather": "Space weather today",
        "live_conditions": "Live conditions",
        "what_it_means": "What this means for you",
        "key_points": "Key points",
        "action": "Action",
        "status_excellent": "Good conditions",
        "status_moderate": "Moderate conditions",
        "status_warning": "Alert conditions",
        "deaf_header": "VISUAL BRIEF — formatted for reading (deaf / hard of hearing)",
        "blind_header": "Screen-reader friendly brief from ZINGSA Navigation News",
        "footer_contact": "ZINGSA Space Science Centre — navigation & space weather support",
    },
    "sn": {
        "agency": "ZINGSA Navigation News",
        "space_weather": "Mamiriro ekuteerera nhasi",
        "live_conditions": "Mamiriro chaiwo",
        "what_it_means": "Zvinoreva chii kwauri",
        "key_points": "Zvinhu zvakakosha",
        "action": "Chii chaunofanira kuita",
        "status_excellent": "Mamiriro akanaka",
        "status_moderate": "Mamiriro pakati nepakati",
        "status_warning": "Mamiriro akaoma — chenjera",
        "deaf_header": "BRIEF YEKUONA — yakarongedzwa kuti uverenge (kurira / kusanzwa zvakanaka)",
        "blind_header": "Brief inoita kuti screen reader ibvume — kubva kuZINGSA Navigation News",
        "footer_contact": "ZINGSA Space Science Centre — rubatsiro rwemazviri ekufamba nekuteerera",
    },
    "nd": {
        "agency": "ZINGSA Navigation News",
        "space_weather": "Isimo sezulu namhlanje",
        "live_conditions": "Isimo sangempela",
        "what_it_means": "Kusho ukuthini kuwe",
        "key_points": "Okubalulekileyo",
        "action": "Okufanele ukwenze",
        "status_excellent": "Isimo esihle",
        "status_moderate": "Isimo esiphakathi",
        "status_warning": "Isimo esiyingozi — qaphela",
        "deaf_header": "UMBUKO WOKUBUKA — uhlengelwe ukufundwa (abapholile / abangazwisisi kahle)",
        "blind_header": "Umbiko olungiselelwe i-screen reader — ovela kuZINGSA Navigation News",
        "footer_contact": "ZINGSA Space Science Centre — usizo lwesimo sezulu nokuzulazula",
    },
}

TONE_SUMMARY: dict[str, dict[str, str]] = {
    "sn": {
        "excellent": "Mamiriro ekuteerera ari akadzikama. GPS nemafoni anofanira kushanda zvakanaka.",
        "moderate": "Mamiriro ekuteerera ari pakati nepakati. GPS inogona kutora nguva kuti ibve pachinzvimbo kana kuti ionekwe kure nepanzvimbo yako.",
        "warning": "Mamiriro ekuteerera akaoma. GPS nemepu inogona kusashanda zvakanaka — shandisa nzira dzakachengeteka.",
    },
    "nd": {
        "excellent": "Isimo sezulu sithule namhlanje. I-GPS nefoni kufanele zisebenze kahle.",
        "moderate": "Isimo sezulu siphakathi. I-GPS ingathatha isikhathi ukuthi ibambe noma ibonakale kude nendawo yakho.",
        "warning": "Isimo sezulu siyingozi. I-GPS nemephu ingase ingasebenzi kahle — sebenzisa izindlela ezivikelekile.",
    },
}

AUDIENCE_TITLE: dict[str, dict[str, str]] = {
    "citizen": {"en": "Space Weather & You", "sn": "Mamiriro Ekuteerera & Iwe", "nd": "Isimo Sezulu & Wena"},
    "farmer": {"en": "Farmer Brief", "sn": "Brief Yevapurazi", "nd": "Umbiko Wabalimi"},
    "surveyor": {"en": "Surveyor Brief", "sn": "Brief Yevanoongesva", "nd": "Umbiko Wabalingi"},
    "driver": {"en": "Driver & Fleet Brief", "sn": "Brief Yevatyari & Mota", "nd": "Umbiko Abashayeli"},
    "aviation": {"en": "Aviation Brief", "sn": "Brief Yezindegi", "nd": "Umbiko Zezindiza"},
    "scientist": {"en": "Scientist Brief", "sn": "Brief Yesainzi", "nd": "Umbiko Wocwaningo"},
}


def labels_for(language: str) -> dict[str, str]:
    return LABELS.get(language, LABELS["en"])


def tone_summary(language: str, tone: str) -> str | None:
    if language == "en":
        return None
    return TONE_SUMMARY.get(language, {}).get(tone)


def audience_title(audience_id: str, language: str) -> str:
    return AUDIENCE_TITLE.get(audience_id, {}).get(language) or AUDIENCE_TITLE.get(audience_id, {}).get("en", "Navigation News")


def status_label(language: str, tone: str) -> str:
    lbl = labels_for(language)
    if tone == "warning":
        return lbl["status_warning"]
    if tone == "moderate":
        return lbl["status_moderate"]
    return lbl["status_excellent"]
