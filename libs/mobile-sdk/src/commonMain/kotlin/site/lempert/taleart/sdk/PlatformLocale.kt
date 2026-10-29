package site.lempert.taleart.sdk

/** The device's locale as a BCP 47 tag (`en-US`, `he-IL`), or `en` when the platform has none. */
expect fun deviceLocale(): String
