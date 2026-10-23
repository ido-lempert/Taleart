package site.lempert.taleart.taller

interface Platform {
    val name: String
}

expect fun getPlatform(): Platform