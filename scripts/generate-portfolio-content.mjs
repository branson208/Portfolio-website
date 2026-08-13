import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const imagesRoot = path.join(root, "Images");
const targetFile = path.join(root, "src", "data", "portfolio.content.generated.json");

const supportedImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const supportedVideoExtensions = new Set([".mp4", ".webm", ".mov", ".m4v"]);

function toSlug(name) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function toTitle(name) {
  return name.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
}

function toMediaType(ext) {
  if (supportedImageExtensions.has(ext)) {
    return "image";
  }
  if (supportedVideoExtensions.has(ext)) {
    return "video";
  }
  return null;
}

if (!fs.existsSync(imagesRoot)) {
  throw new Error("Images directory not found.");
}

const folderEntries = fs.readdirSync(imagesRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());

const sections = folderEntries
  .filter((folder) => folder.name.toLowerCase() !== "all images (unused)")
  .map((folder) => {
    const folderPath = path.join(imagesRoot, folder.name);
    const files = fs
      .readdirSync(folderPath, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const media = files
      .map((name) => {
        const ext = path.extname(name).toLowerCase();
        const type = toMediaType(ext);
        if (!type) {
          return null;
        }

        return {
          type,
          src: `/${folder.name}/${name}`,
          alt: `${toTitle(folder.name)} sample`
        };
      })
      .filter(Boolean);

    return {
      id: toSlug(folder.name),
      slug: toSlug(folder.name),
      title: toTitle(folder.name),
      indexPreviewIntervalMs: 2200,
      indexPreviewMedia: media.slice(0, 5),
      detailGroups: [
        {
          id: `${toSlug(folder.name)}-overview`,
          title: "Overview",
          description: "Update this description in portfolio.content.generated.json.",
          media
        }
      ]
    };
  });

const generated = {
  site: {
    brand: "B-S",
    title: "Industrial Design + Engineering",
    subtitle: "Selected work",
    contactEmail: "you@example.com",
    aboutText: "Generated from your Images folders."
  },
  ordering: {
    queryParam: "order",
    defaultPreset: "default",
    presets: [
      {
        key: "default",
        queryValue: "default",
        label: "Default",
        sectionIds: sections.map((section) => section.id)
      }
    ]
  },
  sections
};

fs.mkdirSync(path.dirname(targetFile), { recursive: true });
fs.writeFileSync(targetFile, `${JSON.stringify(generated, null, 2)}\n`, "utf8");
console.log(`Generated ${targetFile}`);
