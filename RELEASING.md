# Releasing the TaleArt SDKs

Three artifacts ship from one tag `v<version>` (see `.github/workflows/release.yml`):

| Artifact | Where | Built from |
| --- | --- | --- |
| `@lempert/taleart` | npm | `libs/web-sdk` (`dist/libs/web-sdk`) |
| `site.lempert.taleart:mobile-sdk` and `:android-sdk` | Maven Central | `libs/mobile-sdk`, `libs/android-sdk` (`ios-sdk` is not published to Maven) |
| `TaleartSDK.xcframework.zip` | GitHub release of `ido-lempert/Taleart`, used by `Package.swift` | `libs/ios-sdk` on macOS |

The version lives in four places, and `./gradlew :verifyTaleartVersions` fails when they differ (the release
workflow runs it, and `check` and every publish task of the Android SDKs depend on it):

- `gradle.properties`: `taleartVersion`
- `libs/web-sdk/package.json`: `version`
- `libs/mobile-sdk/src/commonMain/kotlin/site/lempert/taleart/sdk/TaleartSdk.kt`: `TaleartSdk.VERSION`
- `Package.swift`: the release URL (`.../releases/download/v<version>/TaleartSDK.xcframework.zip`)

Licence: Apache-2.0 (`LICENSE`), for every component.

Legal pages: the package pages should link to the Terms of service (<https://taleart.lempert.site/legal/terms>) and the
Privacy policy (<https://taleart.lempert.site/legal/privacy>). The npm page shows the README of `libs/web-sdk`, which
links both under "Legal". For Maven Central, add the links to the POM description or URL when the package is next
published (the POM `url` is the repository, whose README has a "Legal" line); the Swift package's page is the
repository README. Keep the texts' version date current when a release changes what the SDKs store or send.

## One-time setup (the owner)

### 1. npm

1. Create the npm organisation `lempert` (this gives the `@lempert` scope) at <https://www.npmjs.com/org/create>, on a
   free plan if nothing else is needed. Add yourself as an owner.
2. Create a granular access token at <https://www.npmjs.com/settings/~/tokens>: permission "Read and write", packages
   and scopes "Only selected packages" or "All packages" in `@lempert`, and bypass 2FA for automation (or use a
   "Automation" token). Keep it; it becomes the `NPM_TOKEN` secret.
3. Provenance needs the repository to be public (it is) and the workflow's `id-token: write` permission (it has it).

### 2. Maven Central (Sonatype Central Portal)

1. Sign in at <https://central.sonatype.com> (GitHub, Google or e-mail).
2. Add the namespace `site.lempert` under "Namespaces". The owner of the domain `lempert.site` proves it with a DNS
   TXT record: the portal shows a verification key, which goes in a TXT record on `lempert.site` (the apex, not a
   subdomain). Wait until the portal shows the namespace as verified (DNS can take a while).
3. Generate a user token at the account menu, "Generate User Token". It shows a username and a password, once.
   Joined as base64 of `<name>:<password>` (the value the portal shows for the Authorization header, without `Bearer`), they become the `MAVEN_TOKEN` secret. They are not your login.
4. Uploads are not public until someone clicks "Publish" on the deployment in the portal (the workflow only uploads;
   see "Per release" below). Maven Central does not allow a version to be replaced once published.

### 3. GPG signing key (Maven Central requires signed artifacts)

```sh
gpg --full-generate-key                      # RSA 4096 (or ed25519), no expiry or a long one, a strong passphrase
gpg --list-secret-keys --keyid-format=long   # note the key id (the long id after rsa4096/)
gpg --keyserver keyserver.ubuntu.com --send-keys <KEYID>
gpg --keyserver keys.openpgp.org --send-keys <KEYID>   # the Central Portal looks the public key up
gpg --armor --export-secret-keys <KEYID> > taleart-signing-key.asc   # the private key: keep it out of the repo
```

- `SIGNING_KEY` is the whole content of `taleart-signing-key.asc` (armored, multi-line).
- `SIGNING_KEY_PASSWORD` is its passphrase.
- Delete `taleart-signing-key.asc` after storing it in the secrets and in a password manager.

The Gradle build signs only when `signingInMemoryKey` is set (CI sets it from the secret). Local builds need no key.
Check the signing path locally with `ORG_GRADLE_PROJECT_signingInMemoryKey="$(cat key.asc)"` and
`ORG_GRADLE_PROJECT_signingInMemoryKeyPassword=...` before `./gradlew :android-sdk:publishToMavenLocal`: it writes `.asc`
files next to each artifact.

### 4. GitHub repository secrets

Settings > Secrets and variables > Actions > New repository secret, for `ido-lempert/Taleart`:

| Secret | Value |
| --- | --- |
| `NPM_TOKEN` | the npm granular token (step 1) |
| `MAVEN_TOKEN` | the Central Portal user token as base64 of `<name>:<password>` (step 2) |
| `SIGNING_KEY` | the armored GPG private key (step 3) |
| `SIGNING_KEY_PASSWORD` | the GPG key's passphrase (step 3) |

`GITHUB_TOKEN` is provided by Actions; the release workflow declares the permissions it needs (`contents: write` for
the GitHub release, `id-token: write` for npm provenance), so the repository's default token setting does not matter.
Actions must be enabled for the repository.

### 5. Local tools (for the dry runs below)

- JDK 21 or newer, the Gradle wrapper (`./gradlew`), Android SDK (for the Android modules).
- Xcode with the Swift toolchain (`swift package compute-checksum`) on macOS, for the XCFramework.
- Node 22 and `npm ci` in the repository.

## Per release

1. Choose the version `X.Y.Z` and set it in the four places above. `Package.swift`: only the version in the URL; the
   checksum is filled by the workflow.
2. Dry run, locally:
   ```sh
   npx nx run-many -t test types-check size --projects=web-sdk
   npx nx run web-sdk:pack                                   # dist/libs/web-sdk-tarball/*.tgz
   ./gradlew :verifyTaleartVersions
   ./gradlew :mobile-sdk:testAndroidHostTest :android-sdk:testDebugUnitTest
   ./gradlew :mobile-sdk:publishToMavenLocal :android-sdk:publishToMavenLocal   # ~/.m2 check
   ./gradlew :ios-sdk:releaseXcframeworkChecksum             # macOS: build/release/TaleartSDK.xcframework.zip(.checksum)
   ```
3. Commit the version bump on `main` and push it. Then tag and push the tag:
   ```sh
   git tag v X.Y.Z && git push origin vX.Y.Z
   ```
4. The `Release` workflow then:
   - verifies the tag against the versions, runs the tests;
   - publishes `@lempert/taleart` to npm (with provenance);
   - uploads `mobile-sdk` and `android-sdk` to the Central Portal (not released yet);
   - builds the XCFramework zip and its checksum on macOS;
   - sets the URL and checksum in `Package.swift`, commits that on the tag's commit, **moves the tag to that commit**
     (`git push --force` of the tag only), and creates the GitHub release `vX.Y.Z` with the zip attached.
   Pushes made with the workflow's own token do not start the workflow again, so the moved tag does not re-trigger it.
5. Release the Maven Central deployment: <https://central.sonatype.com> > Deployments > the `site.lempert.taleart`
   deployment: check it validated, then "Publish". It is public after the portal finishes (minutes to about an hour).
6. Check the results:
   ```sh
   npm view @lempert/taleart@X.Y.Z version
   curl -sI https://repo1.maven.org/maven2/site/lempert/taleart/android-sdk/X.Y.Z/android-sdk-X.Y.Z.pom | head -1
   git ls-remote --tags origin vX.Y.Z           # the tag's commit has the real checksum in Package.swift
   ```
   Then in a scratch Swift package, add `.package(url: "https://github.com/ido-lempert/Taleart", from: "X.Y.Z")`
   and resolve.

If a job fails after npm or Central accepted its part, fix the cause and re-run only the failed job from the Actions
page where that is safe: a version that already exists on npm or Central cannot be published again. In that case bump
the version and release again.

## Publishing only the Web SDK to npm

Tag `web-v<version>` (for example `web-v0.1.0`) runs `.github/workflows/release-npm.yml`: it checks the tag against
`libs/web-sdk/package.json`, runs the Web SDK tests, types and size checks, and publishes `@lempert/taleart` with
provenance. It needs only the `NPM_TOKEN` secret. Maven Central and the iOS XCFramework are not touched; they keep the
full `v<version>` release above.

```sh
npx nx run web-sdk:pack          # dry run: dist/libs/web-sdk-tarball/*.tgz
git tag web-v0.1.0 && git push origin web-v0.1.0
```

## Publishing only the iOS SDK

Tag `v<version>` (for example `v0.1.0`; SwiftPM reads versions from such tags) runs `.github/workflows/release-ios.yml`:
it checks the tag against the versions (`:verifyTaleartVersions`), builds `TaleartSDK.xcframework.zip` on macOS, writes its
url and checksum into `Package.swift`, commits that, moves the tag to the commit and creates the GitHub release with that
one zip as its only asset (GitHub adds its own source archives to every release). It needs no secret. A local dry run:
`./gradlew :ios-sdk:releaseXcframeworkChecksum` (about 4 minutes, an 87 MB zip in `build/release/`).

The all-in-one `release.yml` (npm, Maven Central and iOS together) is started by hand (Actions > Release > Run
workflow) until Maven Central is set up; a tag push no longer starts it.

## Publishing only Maven Central

Tag `maven-v<version>` (for example `maven-v0.1.0`) runs `.github/workflows/release-maven.yml`: it checks the tag against
`taleartVersion` and the other SDK versions, runs the Android host tests, and uploads the signed `mobile-sdk` and
`android-sdk` to the Central Portal. It needs the four secrets in "GitHub repository secrets". Then a person releases
the deployment in the portal (Deployments > Publish); Maven Central never accepts a replacement for a published version.

## Open decisions and TODOs

- The Central deployment is released by hand in the portal (the workflow only uploads). To release automatically,
  switch the `publishToMavenCentral` task to `publishAndReleaseToMavenCentral` (it is in the Vanniktech plugin).
- The iOS deployment target is `iOS 15` (`Package.swift`); not decided by the owner. Adjust it to the lowest version
  the Kotlin/Compose build supports.
- The XCFramework covers `iosArm64` and `iosSimulatorArm64` only (no Intel simulator slice).
- The root `package.json` says `"license": "MIT"` (the private workspace). The SDKs are Apache-2.0 per the decision
  record; change the root field if the workspace is ever published.
- The Maven developer name and the POM URLs use `Ido Lempert` and `github.com/ido-lempert`; check them before the
  first upload.
