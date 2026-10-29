package site.lempert.taleart.sdk.analytics

/**
 * Calls [onBackground] when the app goes to the background (Android: the process lifecycle leaves
 * started; iOS: the app will resign active). Called once per process; the hub uses it to send its
 * queues.
 */
internal expect fun observeAppBackground(onBackground: () -> Unit)
