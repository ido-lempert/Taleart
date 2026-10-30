package site.lempert.taleart.sdk.targeting

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.toKString
import platform.Foundation.NSArray
import platform.Foundation.NSNumber
import platform.Foundation.NSString

@OptIn(ExperimentalForeignApi::class)
// A Swift value reaches the SDK as a Foundation object: a Swift String as an NSString, a Swift Bool or
// number as an NSNumber (a Bool is a char-typed NSNumber), a Swift array as an NSArray.
internal actual fun foundationValue(raw: Any?): Any? = when (raw) {
    is NSNumber -> if (raw.objCType?.toKString() == "c") raw.boolValue else raw.doubleValue
    is NSString -> raw.toString()
    is NSArray -> List(raw.count.toInt()) { foundationValue(raw.objectAtIndex(it.toULong())) }
    is List<*> -> raw.map(::foundationValue)
    else -> raw
}
