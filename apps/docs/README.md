# TaleArt docs

The public docs site: `nx run docs:build` writes static, prerendered pages to `dist/apps/docs/browser`,
which any static host serves. `nx run docs-e2e:e2e` and `nx run docs-e2e:a11y` test the built site.

## Hosting

Serve the site with a Content Security Policy. The API reference page runs Swagger UI and lets a reader
paste an API token into it, so a policy that only lets the site's own scripts run, and only lets the
page call the APIs you expect, keeps an injected script from reading or sending that token. A starting
point, as a response header on every page:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.example.com http://localhost:3333; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
```

- `script-src`: the site's own files (the app, and Swagger UI under `/swagger-ui/`, which the page
  also loads with Subresource Integrity) plus the hashes of the small inline scripts Angular writes
  into each prerendered page (its event replay and state). Take the hashes from the built HTML, or turn
  on Angular's automatic CSP (`security.autoCsp` in the build options), which adds them for you.
- `style-src 'unsafe-inline'`: Angular's prerendered component styles and Swagger UI's inline styles.
- `img-src data:`: Swagger UI's icons are data URLs.
- `connect-src`: the API URLs readers may set on the API reference page. Try it out calls only what
  this allows, so list your TaleArt API origins (and `http://localhost:3333` if readers try a local
  API); requests to any other API URL are blocked by the browser.
- Send `X-Content-Type-Options: nosniff` and `Referrer-Policy: no-referrer` too.
