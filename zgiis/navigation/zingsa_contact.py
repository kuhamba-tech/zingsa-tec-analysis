"""Official ZINGSA contact — from https://zingsa.ac.zw/"""

ZINGSA_WEBSITE = "https://zingsa.ac.zw"
ZINGSA_WEBSITE_LABEL = "zingsa.ac.zw"

ZINGSA_AGENCY = "ZINGSA (Zimbabwe National Geospatial and Space Agency)"

ZINGSA_PHONE = "+263 8677009885"
ZINGSA_EMAIL = "cors@zingsa.ac.zw"
ZINGSA_HOURS = "Mon–Fri, 8am–4pm"
ZINGSA_ADDRESS = (
    "630 Churchill Avenue, Mount Pleasant, Harare "
    "(Zimbabwe Science Park 1, University of Zimbabwe)"
)

ZINGSA_CONTACT_LINE = f"Call {ZINGSA_PHONE} or email {ZINGSA_EMAIL} ({ZINGSA_HOURS})"

ZINGSA_NAVIGATION_HELP_SHORT = f"contact {ZINGSA_AGENCY} on {ZINGSA_PHONE}"

ZINGSA_NAVIGATION_MODERATE_ACTION = (
    f"If your map looks wrong, wait a few seconds or step outside. Still unsure? "
    f"Call ZINGSA on {ZINGSA_PHONE}."
)

ZINGSA_NAVIGATION_WARNING_ACTION = (
    "Do not rely on GPS alone today. Confirm places by phone or street signs. "
    f"Help: {ZINGSA_PHONE} or {ZINGSA_WEBSITE_LABEL}."
)

ZINGSA_NAVIGATION_CHANNELS = [
    f"Phone {ZINGSA_PHONE}",
    ZINGSA_EMAIL,
    ZINGSA_WEBSITE_LABEL,
]

ZINGSA_BROADCAST_FOOTER = [
    "_Free public service · Zimbabwe National Geospatial and Space Agency (ZINGSA)_",
    ZINGSA_CONTACT_LINE,
    ZINGSA_WEBSITE,
]
