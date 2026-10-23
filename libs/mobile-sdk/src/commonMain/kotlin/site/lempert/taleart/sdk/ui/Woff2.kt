package site.lempert.taleart.sdk.ui

// The contract's WOFF2 check (`isWoff2` in libs/contract/src/lib/project-fonts.ts), ported so the
// SDK hands a font loader only bytes the server would have accepted: the header and directories
// are read, nothing is decompressed, and every length and offset is checked against the file.

/** The size of a WOFF2 file's header (`WOFF2_HEADER_BYTES`). */
const val WOFF2_HEADER_BYTES = 48

/** The most tables a WOFF2 file may declare (`MAX_WOFF2_TABLES`). */
const val MAX_WOFF2_TABLES = 256

/** The largest decoded font a WOFF2 file may declare (`MAX_WOFF2_SFNT_BYTES`): 30 MB. */
const val MAX_WOFF2_SFNT_BYTES = 30L * 1024 * 1024

// TrueType, CFF ('OTTO') and a collection ('ttcf').
private val WOFF2_FLAVORS = setOf(0x00010000L, 0x4f54544fL, 0x74746366L)
private const val TTCF = 0x74746366L
private const val GLYF = 10
private const val LOCA = 11

private class Woff2Reader(val d: ByteArray) {
    var at = WOFF2_HEADER_BYTES

    fun u8(i: Int): Int = d[i].toInt() and 0xff
    fun u16(i: Int): Int = (u8(i) shl 8) or u8(i + 1)
    fun u32(i: Int): Long = (u16(i).toLong() shl 16) or u16(i + 2).toLong()

    fun byte(): Int {
        if (at >= d.size) throw IndexOutOfBoundsException()
        return u8(at++)
    }

    // UIntBase128: at most 5 bytes, no leading zero byte, at most 2^32 - 1.
    fun base128(): Long {
        var value = 0L
        for (i in 0 until 5) {
            val b = byte()
            if (i == 0 && b == 0x80) throw IndexOutOfBoundsException()
            if (value > 0x1ffffff) throw IndexOutOfBoundsException()
            value = value * 128 + (b and 0x7f)
            if (b and 0x80 == 0) return value
        }
        throw IndexOutOfBoundsException()
    }

    // 255UInt16, for the collection directory.
    fun uint255(): Int = when (val code = byte()) {
        253 -> (byte() shl 8) or byte()
        255 -> byte() + 253
        254 -> byte() + 506
        else -> code
    }
}

/** Why the bytes are not a sound WOFF2 file (`woff2StructureError`), or null. */
internal fun woff2StructureError(d: ByteArray): String? {
    val r = Woff2Reader(d)
    if (r.u32(4) !in WOFF2_FLAVORS) return "unknown flavour"
    val numTables = r.u16(12)
    if (numTables == 0 || numTables > MAX_WOFF2_TABLES) return "table count out of range"
    if (r.u16(14) != 0) return "reserved field is not 0"
    if (r.u32(16) > MAX_WOFF2_SFNT_BYTES) return "decoded size too large"
    val totalCompressedSize = r.u32(20)
    for ((offset, length) in listOf(r.u32(28) to r.u32(32), r.u32(40) to r.u32(44))) {
        if ((offset == 0L) != (length == 0L) || offset + length > d.size) return "metadata outside the file"
    }
    try {
        var transformedSum = 0L
        for (i in 0 until numTables) {
            val flags = r.byte()
            val tag = flags and 0x3f
            if (tag == 0x3f) r.at += 4
            val version = (flags shr 6) and 0x03
            val origLength = r.base128()
            if (origLength > MAX_WOFF2_SFNT_BYTES) return "table too large"
            val glyfOrLoca = tag == GLYF || tag == LOCA
            val transformed = if (glyfOrLoca) version != 3 else version != 0
            val unknown = if (glyfOrLoca) version == 1 || version == 2 else version != 0 && !(tag == 3 && version == 1)
            if (unknown) return "unknown table transform"
            val length = if (transformed) r.base128() else origLength
            if (transformed && tag == LOCA && length != 0L) return "loca transform length is not 0"
            transformedSum += length
            if (transformedSum > MAX_WOFF2_SFNT_BYTES) return "tables too large"
        }
        if (r.u32(4) == TTCF) {
            r.at += 4
            val numFonts = r.uint255()
            if (numFonts == 0) return "empty collection"
            for (f in 0 until numFonts) {
                val tables = r.uint255()
                r.at += 4
                for (t in 0 until tables) if (r.uint255() >= numTables) return "collection index out of range"
            }
        }
    } catch (_: IndexOutOfBoundsException) {
        return "directory runs past the end of the file"
    }
    if (r.at + totalCompressedSize > d.size) return "compressed data runs past the end of the file"
    return null
}

/**
 * True when the bytes are a WOFF2 file, judged from the bytes alone (`isWoff2`): the `wOF2`
 * signature, a whole header whose total length is the file's size, a known flavour, a reserved
 * field of 0, 1 to [MAX_WOFF2_TABLES] tables, a decoded size of at most [MAX_WOFF2_SFNT_BYTES], and
 * directories, metadata and compressed data that lie inside the file.
 */
fun isWoff2(data: ByteArray): Boolean {
    if (data.size < WOFF2_HEADER_BYTES) return false
    if (data[0] != 0x77.toByte() || data[1] != 0x4f.toByte() || data[2] != 0x46.toByte() || data[3] != 0x32.toByte()) return false
    if (Woff2Reader(data).u32(8) != data.size.toLong()) return false
    return woff2StructureError(data) == null
}
