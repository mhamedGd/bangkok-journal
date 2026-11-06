# Map data and licenses

## Bangkok boundary

OpenStreetMap contributors / Wambacher, distributed by geoBoundaries gbOpen, Thailand ADM1, shape TH-10 (Bangkok).

- Source: https://github.com/wmgeolab/geoBoundaries/tree/main/releaseData/gbOpen/THA/ADM1
- Original boundary year: 2017; geoBoundaries build: December 12, 2023.
- Original license: Open Data Commons Open Database License 1.0, https://opendatacommons.org/licenses/odbl/1-0/
- OpenStreetMap attribution: https://www.openstreetmap.org/copyright
- Changes: extract Bangkok's land boundary; round coordinates to six decimal places; derive an inverse outside-city mask. The derived boundary and mask are available here as GeoJSON under the same ODbL terms.

The administrative city boundary is used, rather than the larger Bangkok metropolitan region. Rail lines outside this boundary are masked too. This boundary excludes maritime jurisdiction in the Gulf.

## Colored urban rail network and stations

Office of Transport and Traffic Policy and Planning (OTP), Ministry of Transport, Thailand. Namtang open data, GTFS feed version **20261105**, valid January 1–December 31, 2026. Retrieved November 6, 2026.

- Publisher and license: https://namtang-api.otp.go.th/opendata
- Feed: https://namtang-api.otp.go.th/download/namtang-gtfs.zip
- License: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/
- Changes: extract the ten urban rail routes; convert their published GTFS shapes to GeoJSON; deduplicate identical/reversed shapes; round coordinates to six decimal places; extract their station platforms; use the feed's route colors without changing their hues; supply concise English line labels. No timetables or live train positions are provided.

The local GeoJSON files contain the complete extracted routes. The displayed map masks their out-of-city portions. These are geographic route shapes, not schematic straight lines joining stations.

## Basemap

OpenStreetMap / OpenMapTiles data served by OpenFreeMap, https://openfreemap.org. The custom monochrome map style is authored for this journal. Attribution remains visible on the map. Street and district labels appear progressively with zoom; areas outside Bangkok are covered by an opaque mask.

## Rebuilding

Download the published boundary GeoJSON (use GitHub's media download for the LFS file) and Namtang GTFS archive, then run:

    python3 scripts/prepare-geography.py thailand-boundaries.geojson namtang-gtfs.zip

This updates the four derived GeoJSON files. Review them and their source versions before publishing. Downloaded source archives are not part of the website.
