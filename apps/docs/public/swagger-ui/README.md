# Swagger UI (vendored)

swagger-ui-dist 5.33.1, npm integrity `sha512-H872wWkA53bFIsGgi7OWgmq+CRWw3nFQGdJWRqOB9wNwTm6e5ol34+qPDkV4AJlK+gglM2EsJiOOzsGsEGbluA==`, Apache-2.0 (see `LICENSE` and `NOTICE`; the bundle's third-party notices are in `swagger-ui-bundle.js.LICENSE.txt`).

Only the files the docs' API reference page loads are kept, byte for byte from the tarball, without source maps: `swagger-ui-bundle.js` and `swagger-ui.css`. The page (`apps/docs/src/app/pages/api-reference.ts`) adds them with Subresource Integrity hashes kept in `api-reference-spec.ts` (`SWAGGER_UI`); a docs test checks those hashes against these files. To upgrade, copy the two files and the licence files from the new verified tarball, then update the version and integrity here and the hashes in `SWAGGER_UI`.
