# 4. Web SDK

The Web SDK is the `<taleart-view>` custom element. The complete reference is [libs/web-sdk/README.md](../../libs/web-sdk/README.md); this page is the short version.

1. Load the SDK from your API: `<script type="module" src="<api-url>/sdk/v1/taleart.js"></script>`. A site can also host the file itself or install the npm package (see the reference).
2. Place a zone: `<taleart-view api-url="<api-url>" site-key="tas_..." zone="<slug>"></taleart-view>`.
3. An element renders only with both a site key and a slug. An unknown slug, or a revoked or rotated key, renders nothing and logs one console error.
4. Pin a build with the pinned URL and integrity value on the Install tab if you want the browser to refuse any other file.
5. Privacy: the SDK keeps a random visitor id in local storage under `taleart.visitor`. Cover it in your privacy notice.

Verified: the snippet and viewer were run in a real browser against a local API (screenshots in [guide 3](03-connect-website.md)).
