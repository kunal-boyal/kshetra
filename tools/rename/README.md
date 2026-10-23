# Renaming the product

`product.json`, at the root, holds the product's name and identifiers (decision D1). `pnpm rename` changes them and rewrites the repository to match, so a rename is one pull request.

```bash
pnpm rename --name "New Name" --slug newname --dry-run
pnpm rename --name "New Name" --slug newname
pnpm install && pnpm tokens && pnpm openapi
```

- `--name` is what people read: the app's name, page titles, photo stamps, the API document's title. It can change at any time.
- `--scope` is the workspace packages' npm scope (`@scope/shared`). It can change at any time, and follows the slug unless given.
- `--slug` names identifiers: `PRODUCT_SLUG`, token issuers, the refresh cookie, Redis and queue prefixes, AWS resource names, the app's link scheme. `--app-id` is the Android application ID and iOS bundle ID, and follows the slug unless given. Both change only until launch. Set `"launched": true` in `product.json` when the first store build is uploaded: Google Play never lets an app change its ID, and a new slug would sign everyone out and make Terraform replace every AWS resource.

What a pull request can't change stays as it is: the Expo project, the Firebase project and the repository (`external`), and the local services' database, bucket and credentials, so existing local data keeps working. `keep` lists the text never rewritten, and `skip` the files. The script prints the steps left outside the repository, such as registering a new app ID with Firebase and the Maps key.

It rewrites tracked text files only; images keep their bytes. The mark carries no wordmark, so it survives a rename. A design-system file it changes is mirrored to the design system artifact in the same piece of work.
