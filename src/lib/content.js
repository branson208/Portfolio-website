import content from "../data/portfolio.content.json";

function toMapById(sections) {
  return new Map(sections.map((section) => [section.id, section]));
}

function getPresetMap(ordering) {
  const presets = ordering?.presets ?? [];
  return new Map(presets.map((preset) => [preset.queryValue, preset.sectionIds]));
}

function mergeCustomFrontWithDefault(defaultIds, customIds) {
  const uniqueCustom = customIds.filter((id, idx) => customIds.indexOf(id) === idx);
  const remainder = defaultIds.filter((id) => !uniqueCustom.includes(id));
  return [...uniqueCustom, ...remainder];
}

export function getOrderedSections(search = "") {
  const sections = content.sections ?? [];
  const ordering = content.ordering ?? {};
  const sectionMap = toMapById(sections);
  const allSectionIds = sections.map((section) => section.id);

  const presets = ordering.presets ?? [];
  const defaultPreset = presets.find((preset) => preset.key === ordering.defaultPreset);
  const defaultIds = defaultPreset?.sectionIds?.length ? defaultPreset.sectionIds : allSectionIds;

  const params = new URLSearchParams(search);
  const queryParam = ordering.queryParam ?? "order";
  const value = params.get(queryParam);

  let orderedIds = defaultIds;

  if (value) {
    const presetMap = getPresetMap(ordering);
    const presetOrder = presetMap.get(value);
    if (presetOrder?.length) {
      orderedIds = presetOrder;
    } else {
      const customOrder = value.split(",").map((item) => item.trim()).filter(Boolean);
      const validCustomOrder = customOrder.filter((id) => sectionMap.has(id));
      if (validCustomOrder.length) {
        orderedIds = mergeCustomFrontWithDefault(defaultIds, validCustomOrder);
      }
    }
  }

  const validIds = orderedIds.filter((id) => sectionMap.has(id));
  const remainingIds = allSectionIds.filter((id) => !validIds.includes(id));

  return [...validIds, ...remainingIds].map((id) => sectionMap.get(id));
}

export function getSectionBySlug(slug) {
  return (content.sections ?? []).find((section) => section.slug === slug);
}

export function getSiteConfig() {
  return content.site ?? {};
}

export function getAboutConfig() {
  return content.about ?? {};
}

export function getOrderExamples() {
  const ordering = content.ordering ?? {};
  const queryParam = ordering.queryParam ?? "order";
  const presets = ordering.presets ?? [];

  return presets.map((preset) => ({
    label: preset.label,
    href: `/?${queryParam}=${encodeURIComponent(preset.queryValue)}`
  }));
}

export function flattenSectionMedia(section) {
  const groups = section?.detailGroups ?? [];
  return groups.flatMap((group, groupIndex) =>
    (group.media ?? []).map((item, mediaIndex) => ({
      ...item,
      groupIndex,
      mediaIndex,
      description: group.description,
      groupTitle: group.title
    }))
  );
}
