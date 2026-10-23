package site.lempert.taleart.sdk

import site.lempert.taleart.sdk.delivery.DeliveryClient

/** Shared TaleArt SDK core used by android-sdk and ios-sdk. */
object TaleartSdk {
    const val VERSION = "0.0.1"

    /**
     * The process's Delivery client, used by every zone not given its own. One client for the whole
     * app, as the Web SDK shares one module: zones that ask for the same zone at once share a request
     * and its ETag copy. It is never closed.
     */
    val sharedClient: DeliveryClient by lazy { DeliveryClient() }
}
