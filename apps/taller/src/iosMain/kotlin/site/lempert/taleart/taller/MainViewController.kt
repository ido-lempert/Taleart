package site.lempert.taleart.taller

import androidx.compose.runtime.remember
import androidx.compose.ui.window.ComposeUIViewController

fun MainViewController() = ComposeUIViewController {
    val store = remember { UserDefaultsStore() }
    App(store = store)
}