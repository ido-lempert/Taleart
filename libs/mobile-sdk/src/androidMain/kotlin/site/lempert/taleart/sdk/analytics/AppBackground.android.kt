package site.lempert.taleart.sdk.analytics

import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.ProcessLifecycleOwner

// The process lifecycle stops when its last started screen stops: the app is in the background.
internal actual fun observeAppBackground(onBackground: () -> Unit) {
    ProcessLifecycleOwner.get().lifecycle.addObserver(
        LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_STOP) onBackground()
        },
    )
}
