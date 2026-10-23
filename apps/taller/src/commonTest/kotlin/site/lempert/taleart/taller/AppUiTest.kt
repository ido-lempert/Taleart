package site.lempert.taleart.taller

import androidx.compose.ui.test.ExperimentalTestApi
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.v2.runComposeUiTest
import site.lempert.taleart.sdk.TaleartSdk
import kotlin.test.Test

@OptIn(ExperimentalTestApi::class)
class AppUiTest : ComposeUiTestBase() {

    @Test
    fun showsTheTitleAndTheSdkVersion() = runComposeUiTest {
        setContent { App() }

        onNodeWithTag("title").assertIsDisplayed().assertTextEquals("TaleArt")
        onNodeWithTag("sdk-version").assertIsDisplayed().assertTextEquals("SDK ${TaleartSdk.VERSION}")
    }
}
