package site.lempert.taleart.sdk.ui

import androidx.compose.ui.text.font.FontFamily
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.respond
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.headersOf
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.runTest
import site.lempert.taleart.sdk.delivery.DeliveryFont
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue
import kotlin.time.Duration.Companion.seconds
import kotlin.time.TestTimeSource

// Loading project fonts (R18) as the Web SDK's loadProjectFont does, on a fake server.
class ProjectFontsTest {
    private val id = "0f0e0d0c-0000-4000-8000-00000000000a"
    private val other = "0f0e0d0c-0000-4000-8000-00000000000b"
    private fun font(fontId: String = id) = DeliveryFont(fontId, "https://cdn.test/fonts/$fontId.woff2", 700, "normal")

    /**
     * A WOFF2 file: the header, the table [directory] (by default one untransformed `cmap` of 4
     * bytes), and [data] bytes of "compressed" data; [flavor], [tables], metadata and the declared
     * length can be set to test the check.
     */
    private fun woff2(
        data: Int = 16,
        declaredLength: Int? = null,
        flavor: Long = 0x00010000,
        tables: Int = 1,
        directory: List<Int> = listOf(0x00, 0x04),
        metaOffset: Long = 0,
        metaLength: Long = 0,
    ): ByteArray {
        val size = 48 + directory.size + data
        val b = ByteArray(size)
        fun u32(at: Int, v: Long) { for (i in 0 until 4) b[at + i] = (v shr (24 - 8 * i)).toByte() }
        fun u16(at: Int, v: Int) { b[at] = (v shr 8).toByte(); b[at + 1] = v.toByte() }
        "wOF2".forEachIndexed { i, c -> b[i] = c.code.toByte() }
        u32(4, flavor)
        u32(8, (declaredLength ?: size).toLong())
        u16(12, tables)
        u16(14, 0)
        u32(16, 1024)
        u32(20, data.toLong())
        u32(28, metaOffset)
        u32(32, metaLength)
        directory.forEachIndexed { i, v -> b[48 + i] = v.toByte() }
        return b
    }

    private val made = mutableListOf<String>()
    private val maker: (String, ByteArray, Int, Boolean) -> FontFamily? = { fontId, _, _, _ -> made += fontId; FontFamily.Serif }

    // A fake server on the test's clock, so its delays and the loader's timeout share virtual time.
    private fun TestScope.server(requests: MutableList<String> = mutableListOf(), answer: suspend () -> Triple<ByteArray, HttpStatusCode, Long?>) =
        HttpClient(MockEngine) {
            engine {
                dispatcher = StandardTestDispatcher(testScheduler)
                addHandler { request ->
                    requests += request.url.toString()
                    val (body, status, length) = answer()
                    respond(body, status, if (length != null) headersOf(HttpHeaders.ContentLength, length.toString()) else headersOf())
                }
            }
        }

    @Test
    fun theContractsWoff2CheckIsPorted() {
        assertTrue(isWoff2(woff2()))
        assertFalse(isWoff2(woff2(declaredLength = 10_000)), "the header's length must be the file's")
        assertFalse(isWoff2(woff2().copyOf(60)), "compressed data past the end")
        assertFalse(isWoff2(woff2().also { it[4] = 9 }), "unknown flavour")
        assertFalse(isWoff2(woff2().also { it[12] = 0; it[13] = 0 }), "no tables")
        assertFalse(isWoff2(woff2().also { it[16] = 0x7f }), "decoded size over 30 MB")
        assertFalse(isWoff2("wOFF".encodeToByteArray() + ByteArray(60)))
    }

    @Test
    fun theWoff2CheckReadsBase128AndTheTransformRules() {
        // UIntBase128: 0x82 0x00 is 256; a leading 0x80 and a value that runs past 5 bytes are refused.
        assertTrue(isWoff2(woff2(directory = listOf(0x00, 0x82, 0x00))))
        assertFalse(isWoff2(woff2(directory = listOf(0x00, 0x80, 0x04))), "leading zero byte")
        assertFalse(isWoff2(woff2(directory = listOf(0x00, 0xff, 0xff, 0xff, 0xff, 0x7f))), "more than 5 bytes")
        assertFalse(isWoff2(woff2(directory = listOf(0x00, 0x8f, 0xff, 0xff, 0xff, 0x7f))), "over 2^32 - 1")
        // glyf (10) version 0 is transformed and carries its transformed length; versions 1 and 2 are unknown.
        assertTrue(isWoff2(woff2(directory = listOf(10, 0x04, 0x02))))
        assertFalse(isWoff2(woff2(directory = listOf(0x40 or 10, 0x04))), "glyf version 1")
        // loca (11) transformed must have a length of 0; version 3 is untransformed.
        assertTrue(isWoff2(woff2(directory = listOf(11, 0x04, 0x00))))
        assertFalse(isWoff2(woff2(directory = listOf(11, 0x04, 0x02))), "loca transform length")
        assertTrue(isWoff2(woff2(directory = listOf(0xc0 or 11, 0x04))))
        // hmtx (3) version 1 is the one other transform; any other table's version 1 is unknown.
        assertTrue(isWoff2(woff2(directory = listOf(0x40 or 3, 0x04, 0x02))))
        assertFalse(isWoff2(woff2(directory = listOf(0x40 or 0, 0x04, 0x02))), "cmap version 1")
        // An arbitrary tag (63) carries its 4 bytes.
        assertTrue(isWoff2(woff2(directory = listOf(0x3f, 0x61, 0x62, 0x63, 0x64, 0x04))))
        assertFalse(isWoff2(woff2(directory = listOf(0x3f, 0x61, 0x62), data = 0)), "directory past the end")
    }

    @Test
    fun theWoff2CheckReadsCollectionsAndMetadata() {
        val ttcf = 0x74746366L
        // A collection: version, one font of one table (index 0).
        val collection = listOf(0x00, 0x04, 0, 1, 0, 0, 1, 1, 0x00, 0x01, 0x00, 0x00, 0)
        assertTrue(isWoff2(woff2(flavor = ttcf, directory = collection)))
        assertFalse(isWoff2(woff2(flavor = ttcf, directory = collection.dropLast(1) + 1)), "table index out of range")
        assertFalse(isWoff2(woff2(flavor = ttcf, directory = listOf(0x00, 0x04, 0, 1, 0, 0, 0))), "empty collection")
        // Metadata: an offset needs a length, and both lie inside the file.
        assertTrue(isWoff2(woff2(metaOffset = 50, metaLength = 4)))
        assertFalse(isWoff2(woff2(metaOffset = 50, metaLength = 0)), "offset without length")
        assertFalse(isWoff2(woff2(metaOffset = 50, metaLength = 1_000)), "metadata past the end")
    }

    @Test
    fun aSoundFaceLoadsOnceAndIsNamedById() = runTest {
        val requests = mutableListOf<String>()
        val loader = ProjectFontLoader(readsWoff2 = true, make = maker)
        val http = server(requests) { Triple(woff2(), HttpStatusCode.OK, null) }
        loader.load(listOf(font(), font(other)), http)
        loader.load(listOf(font()), http)
        assertNotNull(loader.family(id.uppercase()))
        assertEquals(2, requests.size)
        assertEquals(setOf(id, other), made.toSet())
    }

    @Test
    fun facesLoadInParallel() = runTest {
        val loader = ProjectFontLoader(readsWoff2 = true, make = maker)
        val http = server { delay(2_000); Triple(woff2(), HttpStatusCode.OK, null) }
        val start = testScheduler.currentTime
        loader.load(listOf(font(), font(other)), http)
        assertEquals(2_000, testScheduler.currentTime - start, "two faces of 2 s take 2 s, not 4")
        // Two faces of 2 s each, within the 3 s timeout of one: they loaded side by side.
        assertNotNull(loader.family(id))
        assertNotNull(loader.family(other))
    }

    @Test
    fun aFileOverTheSizeCapIsRefusedByItsDeclaredOrRealLength() = runTest {
        val declared = ProjectFontLoader(readsWoff2 = true, make = maker)
        declared.load(listOf(font()), server { Triple(woff2(), HttpStatusCode.OK, MAX_FONT_BYTES + 1L) })
        assertNull(declared.family(id))
        assertEquals("its file declares more than $MAX_FONT_BYTES bytes", declared.lastFailure)
        // 2 MB sent without a length: the loader reads one byte past the cap and stops.
        val sent = ProjectFontLoader(readsWoff2 = true, make = maker)
        sent.load(listOf(font()), server { Triple(woff2(data = 2 * 1024 * 1024), HttpStatusCode.OK, null) })
        assertNull(sent.family(id))
        assertEquals("its file is larger than $MAX_FONT_BYTES bytes (${MAX_FONT_BYTES + 1} read)", sent.lastFailure)
        assertTrue(made.isEmpty())
    }

    @Test
    fun aFileThatIsNotWoff2OrAnErrorIsRefused() = runTest {
        val loader = ProjectFontLoader(readsWoff2 = true, make = maker)
        loader.load(listOf(font()), server { Triple("<svg/>".encodeToByteArray(), HttpStatusCode.OK, null) })
        assertNull(loader.family(id))
        val missing = ProjectFontLoader(readsWoff2 = true, make = maker)
        missing.load(listOf(font()), server { Triple(ByteArray(0), HttpStatusCode.NotFound, null) })
        assertEquals("its file answered 404", missing.lastFailure)
        assertTrue(made.isEmpty())
    }

    @Test
    fun aFontWhoseIdIsNotAUuidIsNeverFetched() = runTest {
        val requests = mutableListOf<String>()
        val loader = ProjectFontLoader(readsWoff2 = true, make = maker)
        loader.load(listOf(font("../../etc/passwd"), font("x")), server(requests) { Triple(woff2(), HttpStatusCode.OK, null) })
        assertTrue(requests.isEmpty())
    }

    @Test
    fun aSlowFaceTimesOutAndIsRetriedOnlyAfterAMinute() = runTest {
        val clock = TestTimeSource()
        val requests = mutableListOf<String>()
        var slow = true
        val loader = ProjectFontLoader(timeSource = clock, readsWoff2 = true, make = maker)
        val http = server(requests) {
            if (slow) delay(5_000)
            Triple(woff2(), HttpStatusCode.OK, null)
        }
        loader.load(listOf(font()), http)
        assertNull(loader.family(id))
        assertEquals("it did not load within $FONT_LOAD_TIMEOUT_MS ms", loader.lastFailure)
        slow = false
        clock += 59.seconds
        loader.load(listOf(font()), http)
        assertEquals(1, requests.size, "not tried again within the minute")
        clock += 2.seconds
        loader.load(listOf(font()), http)
        assertEquals(2, requests.size)
        assertNotNull(loader.family(id))
    }

    @Test
    fun aLoadCancelledBeforeItsFacesStartLeavesNoneMarkedLoading() = runTest {
        val requests = mutableListOf<String>()
        val loader = ProjectFontLoader(readsWoff2 = true, make = maker)
        val http = server(requests) { Triple(woff2(), HttpStatusCode.OK, null) }
        // Runs until its children are scheduled, then is cancelled before any of them starts.
        val first = launch(start = CoroutineStart.UNDISPATCHED) { loader.load(listOf(font()), http) }
        first.cancel()
        advanceUntilIdle()
        assertTrue(requests.isEmpty())
        loader.load(listOf(font()), http)
        assertEquals(1, requests.size)
        assertNotNull(loader.family(id))
    }

    @Test
    fun aPlatformThatCannotReadWoff2DownloadsNothing() = runTest {
        val requests = mutableListOf<String>()
        val loader = ProjectFontLoader(readsWoff2 = false, make = maker)
        loader.load(listOf(font()), server(requests) { Triple(woff2(), HttpStatusCode.OK, null) })
        assertTrue(requests.isEmpty())
        assertNull(loader.family(id))
    }
}
