# Industrial Portfolio (React + Vite)

This project is a dynamic portfolio site inspired by the interaction style of the reference website, but tuned for industrial design and engineering work.

## Run locally

```bash
npm install
npm run dev
```

## Content model (single source of truth)

Edit:

- `src/data/portfolio.content.json`

Key parts:

- `sections[]`: all portfolio sections.
- `indexPreviewMedia[]`: media that cycles on the home page card for that section.
- `detailGroups[]`: groups of media that share the same description.
- `detailGroups[].media[]`: all media shown inside a section page.

If you want the same description across multiple images, put those images in the same `detailGroups[]` entry.
If you want descriptions to change at certain points, create multiple groups.

## URL argument based ordering

Ordering is configured in `ordering` inside `src/data/portfolio.content.json`.

- Query parameter name: `ordering.queryParam` (default `order`)
- Preset key to use when no param is supplied: `ordering.defaultPreset`
- Presets list: `ordering.presets[]`

Example links:

- Default: `/?order=default`
- Engineering first: `/?order=eng`
- Product first: `/?order=product`

Custom order is also supported directly in URL by section ids:

- `/?order=automation,product-design,tooling-and-fixtures`

Any sections not listed are appended automatically.

## Auto-generate a config from folders

If you add folders/media in `Images`, generate a fresh JSON seed:

```bash
npm run sync:content
```

This writes:

- `src/data/portfolio.content.generated.json`

Then copy what you want from generated into `src/data/portfolio.content.json`.

## Media format note

Browsers do not reliably support HEIC/MKV. For best compatibility, use:

- Images: `.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`
- Video: `.mp4`, `.webm`
