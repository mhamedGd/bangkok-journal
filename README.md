# Bangkok journal

A personal map journal, hosted on GitHub Pages. Public memories; editing belongs to **mhamedGd**. The interface uses a monochrome game-style HUD: system monospace fonts, square panels, and compact controls. The basemap is black and white, with the published route colors reserved for rail lines.

## Open the journal

https://mhamedgd.github.io/bangkok-journal/

Explore Bangkok, search memories, filter by day or category, and open photographs. The map includes 30 curated landmarks, malls, and airports. Use the map search to find them, the Places menu to toggle categories, or select a place to see its name. When editing is enabled, Add memory here pre-fills its location and place name. Use **Rail & metro** to show or hide rail infrastructure, including underground lines, and **Line colors** for the legend. The map includes Bangkok and its surrounding metro area, including both airports. Areas outside that region are hidden. You can pan any region edge to the center of the map; bounds adjust with zoom and viewport size rather than pinning the city edges to the viewport edges. The journal starts empty: no invented trip memories are published.

## Add your first memory

1. Open **Owner access**.
2. Follow **Create your repository key on GitHub**. Choose **Only select repositories → bangkok-journal**, and grant **Contents: Read and write**. Metadata read access is automatic. No workflow, administration, or account permissions are needed. Set an expiration you are comfortable with.
3. Paste the key into the journal and choose **Enable editing**. Do not send the key in a chat or commit it to this repository.
4. Choose **Add memory**, then click its location on the map. Give it a title, place, date, notes, optional category, and up to eight photos.
5. Choose **Save memory**. One commit saves its notes, coordinates, and photos together. GitHub Actions publishes the new site, usually within a few minutes. The current tab shows the saved memory immediately.

The key is held only in JavaScript memory in the current tab. Reloading or choosing **Lock editing** clears it. This is repository-key authentication, not an OAuth “Sign in with GitHub” flow; it avoids an additional server or hosting account. The app checks the immutable GitHub user ID before unlocking, and GitHub enforces repository write access on every mutation. Public visitors have no write credentials. Keep the repository's collaborator list limited to people you actually want to trust with its source.

## Photos and privacy

- Everything committed to this public repository is public, including older versions. Removing a memory does not erase Git history.
- JPEG, PNG, and WebP uploads are converted to JPEG, capped at 1600 pixels on their longest side. Canvas re-encoding strips the original EXIF metadata, including GPS tags. Keep original photographs elsewhere.
- A memory is saved only when **Save memory** is pressed. Selecting photos alone does not upload anything.
- Close the editor only after saving if you want to keep a draft. Unpublished drafts are not stored on disk or synchronized.
- OpenFreeMap supplies OpenStreetMap vector tiles. Interface text uses system monospace fonts. OpenFreeMap receives ordinary browser requests; journal files are hosted on GitHub Pages. No analytics is installed.

## Develop locally

Requires Node.js 20+ for tests and Python 3 for the preview server. No package installation or build step is needed.

```sh
npm test
npm run dev
```

Open http://localhost:4173. The owner editor connects to the real configured GitHub repository, even from local preview. Do not save test memories to the main branch.

## Files and publishing

- `site/config.js`: public GitHub owner ID, repository, and branch. Never put credentials here.
- `site/data/memories.json`: journal data, UTF-8 JSON.
- `site/photos/<memory-id>/`: processed photographs.
- `site/github.js`: authentication, conflict detection, and atomic Git commits.
- `site/map-style.json`: the custom monochrome map, with quieter streets and colored rail routes. Street names and station labels appear when zoomed in.
- `site/data/bangkok-*.geojson`: the published city and metro region boundaries, outside masks, and OTP rail shapes and stations.
- `site/data/places.geojson`: curated landmarks, malls, and airports, with individual source links. See `site/data/SOURCES.md` for source versions, licenses, and changes.
- `.github/workflows/pages.yml`: publishes `site/` after changes to the main branch.

Repository **Settings → Pages → Source** must be **GitHub Actions**. The account used by the editor needs write access to the configured branch; branch protections requiring pull requests will prevent direct saves.

Saving reads an immutable snapshot of the latest branch, applies the change, creates a Git tree and commit, then updates the branch without force. Unrelated concurrent changes are merged and retried. Conflicting changes to the same memory are rejected with the text left in the editor. Save failures never report success. If a network timeout leaves the outcome uncertain, refresh and check before retrying.

For a backup, use GitHub's **Code → Download ZIP** or clone this repository. GitHub Pages has hosting limits; resized images keep the journal smaller, but it is not intended as an unlimited original-photo archive.

## Dependencies

Leaflet 1.9.4, MapLibre GL JS 5.6.2, and the MapLibre Leaflet bridge 0.1.4 are vendored under `site/vendor/`; their licenses are included. Map data © OpenStreetMap contributors, served by OpenFreeMap / OpenMapTiles with attribution. Rendering the vector map requires WebGL. All other code is plain browser JavaScript and CSS.

For isolated browser testing, run `node tests/preview.mjs` and visit http://localhost:4180. Use the fake key `preview-key`. That server keeps its test memories only in memory and does not contact GitHub. It is not included in the published site.
