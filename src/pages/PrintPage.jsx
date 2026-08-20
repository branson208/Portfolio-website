import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { getAboutConfig, getOrderedSections, getSiteConfig } from "../lib/content";

const videoThumbCache = new Map();
const MEDIA_ADJUSTMENTS_KEY = "portfolio.print.mediaAdjustments.v1";
const MEDIA_LAYOUT_PREFS_KEY = "portfolio.print.mediaLayoutPrefs.v1";
const DEFAULT_MEDIA_ADJUSTMENT = { x: 0, y: 0, zoom: 100, frame: 0 };
const DEFAULT_LAYOUT_MODE = "columns";
const DEFAULT_MEDIA_LIMIT = "auto";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getMediaTransformStyle(xOffset = 0, yOffset = 0, zoom = 100) {
  const x = clamp(xOffset, -50, 50);
  const y = clamp(yOffset, -50, 50);
  const z = clamp(zoom, 100, 220) / 100;
  // Object-position exposes the source image edge. The zoomed box must move in
  // the opposite direction so its overflow stays aligned with that same edge.
  const maxZoomPan = (z - 1) * 50;
  const zoomPanX = -(x / 50) * maxZoomPan;
  const zoomPanY = -(y / 50) * maxZoomPan;
  return {
    objectPosition: `${50 + x}% ${50 + y}%`,
    transform: `translate(${zoomPanX}%, ${zoomPanY}%) scale(${z})`,
    transformOrigin: "center center",
  };
}

function waitForPreviewMedia() {
  const media = Array.from(document.querySelectorAll(".print-content img"));
  return Promise.all(media.map((image) => {
    if (image.complete && image.naturalWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", resolve, { once: true });
    });
  }));
}

function loadMediaAdjustments() {
  try {
    const raw = window.localStorage.getItem(MEDIA_ADJUSTMENTS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const next = {};
    Object.entries(parsed).forEach(([src, value]) => {
      if (!src || !value || typeof value !== "object") return;
      const x = Number.isFinite(value.x) ? clamp(value.x, -50, 50) : 0;
      const y = Number.isFinite(value.y) ? clamp(value.y, -50, 50) : 0;
      const zoom = Number.isFinite(value.zoom) ? clamp(value.zoom, 100, 220) : 100;
      const frame = Number.isFinite(value.frame) ? clamp(value.frame, 0, 100) : 0;
      next[src] = { x, y, zoom, frame };
    });
    return next;
  } catch {
    return {};
  }
}

function loadMediaLayoutPrefs() {
  try {
    const raw = window.localStorage.getItem(MEDIA_LAYOUT_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};

    const next = {};
    Object.entries(parsed).forEach(([projectKey, value]) => {
      if (!projectKey || !value || typeof value !== "object") return;
      const legacyMode = value.layoutMode === "rows" ? "rows" : "columns";
      const fromPreset = typeof value.layoutPreset === "string" && value.layoutPreset.includes("rows")
        ? "rows"
        : "columns";
      const layoutMode = value.layoutMode === "rows" || value.layoutMode === "columns"
        ? value.layoutMode
        : (typeof value.layoutPreset === "string" ? fromPreset : legacyMode);
      const mediaLimit = value.mediaLimit === "auto"
        ? "auto"
        : Number.isFinite(value.mediaLimit)
          ? clamp(Math.round(value.mediaLimit), 1, 4)
          : DEFAULT_MEDIA_LIMIT;
      const order = Array.isArray(value.order)
        ? value.order.filter((src) => typeof src === "string" && src.length > 0)
        : [];
      const selected = Array.isArray(value.selected)
        ? value.selected.filter((src) => typeof src === "string" && src.length > 0)
        : [];
      next[projectKey] = { layoutMode, mediaLimit, order, selected };
    });
    return next;
  } catch {
    return {};
  }
}

function normalizeParagraphs(text) {
  if (Array.isArray(text)) {
    return text
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
  }

  if (typeof text === "string") {
    return text
      .split(/\n\s*\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  return [];
}

function getProjectAnchor(projectIndex) {
  return `print-project-${String(projectIndex + 1).padStart(3, "0")}`;
}

function renderTextWithLinks(text, keyPrefix) {
  const parts = text.split(/(bransonmurdock\.com)/gi);
  return parts.map((part, idx) => {
    if (/^bransonmurdock\.com$/i.test(part)) {
      return (
        <a key={`${keyPrefix}-link-${idx}`} href="https://bransonmurdock.com" className="print-inline-link">
          {part}
        </a>
      );
    }
    return part;
  });
}

function getRenderableMedia(group) {
  const media = Array.isArray(group?.media) ? group.media : [];
  return media.filter((item) => item?.src && (item?.type === "image" || item?.type === "video"));
}

function getMediaLayoutClass(count, layoutMode = DEFAULT_LAYOUT_MODE) {
  const isRows = layoutMode === "rows";
  if (count <= 0) return "print-media-grid--empty";
  if (count === 1) return "print-media-grid--single";
  if (count === 2) return isRows ? "print-media-grid--two-rows" : "print-media-grid--two";
  if (count === 3) return isRows ? "print-media-grid--three-rows" : "print-media-grid--three";
  return isRows ? "print-media-grid--four-rows" : "print-media-grid--four";
}

function getMediaLabel(item, index) {
  if (item?.alt) return item.alt;
  const src = item?.src || "";
  const file = src.split("/").pop() || "Media";
  return `${index + 1}. ${file}`;
}

function orderMediaByPreference(mediaItems, order = []) {
  if (!Array.isArray(order) || order.length === 0) return mediaItems;
  const rank = new Map(order.map((src, idx) => [src, idx]));
  return [...mediaItems].sort((a, b) => {
    const ar = rank.has(a.src) ? rank.get(a.src) : Number.MAX_SAFE_INTEGER;
    const br = rank.has(b.src) ? rank.get(b.src) : Number.MAX_SAFE_INTEGER;
    if (ar === br) return 0;
    return ar - br;
  });
}

function swapMediaOrder(order = [], srcA, srcB) {
  if (!srcA || !srcB || srcA === srcB) return order;
  const next = [...order];
  const aIdx = next.indexOf(srcA);
  const bIdx = next.indexOf(srcB);
  if (aIdx === -1 || bIdx === -1) return order;
  next[aIdx] = srcB;
  next[bIdx] = srcA;
  return next;
}

function VideoPosterSquare({ src, alt, xOffset = 0, yOffset = 0, zoom = 100, framePercent = 0, onDurationChange }) {
  const cacheKey = `${src}|f:${Math.round(framePercent)}`;
  const [poster, setPoster] = useState(() => videoThumbCache.get(cacheKey) || "");

  useEffect(() => {
    if (!src || videoThumbCache.has(cacheKey)) {
      if (videoThumbCache.has(cacheKey)) setPoster(videoThumbCache.get(cacheKey));
      return;
    }

    let cancelled = false;
    const video = document.createElement("video");
    video.src = src;
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.crossOrigin = "anonymous";

    const drawFrame = () => {
      if (cancelled) return;
      const vw = video.videoWidth || 0;
      const vh = video.videoHeight || 0;
      if (!vw || !vh) return;

      // Store the full frame, then crop/position it in CSS like normal images.
      const maxEdge = 1200;
      const scale = Math.min(1, maxEdge / Math.max(vw, vh));
      const outW = Math.max(1, Math.round(vw * scale));
      const outH = Math.max(1, Math.round(vh * scale));
      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, vw, vh, 0, 0, outW, outH);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
      videoThumbCache.set(cacheKey, dataUrl);
      if (!cancelled) setPoster(dataUrl);
    };

    const onLoaded = () => {
      const duration = video.duration && Number.isFinite(video.duration) ? video.duration : 0;
      onDurationChange?.(duration);

      const seekTarget = duration > 0
        ? clamp((framePercent / 100) * duration, 0, Math.max(duration - 0.01, 0))
        : 0;

      if (seekTarget > 0) {
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          drawFrame();
        };
        video.addEventListener("seeked", onSeeked);
        try {
          video.currentTime = seekTarget;
        } catch {
          drawFrame();
        }
      } else {
        drawFrame();
      }
    };

    video.addEventListener("loadeddata", onLoaded, { once: true });

    return () => {
      cancelled = true;
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [src, cacheKey, framePercent, onDurationChange]);

  if (poster) {
    return (
      <img
        className="print-media-asset"
        src={poster}
        alt={alt}
        loading="eager"
        decoding="async"
        style={getMediaTransformStyle(xOffset, yOffset, zoom)}
      />
    );
  }

  return <div className="print-media-placeholder">Video preview loading...</div>;
}

function MediaSquare({ item, fallbackAlt, xOffset = 0, yOffset = 0, zoom = 100, framePercent = 0, onDurationChange }) {
  if (!item) return null;
  if (item.type === "video") {
    return (
      <VideoPosterSquare
        src={item.src}
        alt={item.alt || fallbackAlt || "Video preview"}
        xOffset={xOffset}
        yOffset={yOffset}
        zoom={zoom}
        framePercent={framePercent}
        onDurationChange={onDurationChange}
      />
    );
  }

  return (
    <img
      className="print-media-asset"
      src={item.src}
      alt={item.alt || fallbackAlt || "Project preview"}
      loading="eager"
      decoding="async"
      style={getMediaTransformStyle(xOffset, yOffset, zoom)}
    />
  );
}

function MediaAdjustControls({ item, adjustment, onUpdate, durationSeconds }) {
  const safeId = encodeURIComponent(item?.src || "media").replace(/%/g, "");
  const xValue = Number.isFinite(adjustment?.x) ? adjustment.x : 0;
  const yValue = Number.isFinite(adjustment?.y) ? adjustment.y : 0;
  const zoomValue = Number.isFinite(adjustment?.zoom) ? adjustment.zoom : 100;
  const frameValue = Number.isFinite(adjustment?.frame) ? adjustment.frame : 0;
  const frameTime = durationSeconds > 0
    ? ((frameValue / 100) * durationSeconds).toFixed(1)
    : "0.0";

  return (
    <div className="print-media-controls">
      <label className="print-control-row" htmlFor={`x-${safeId}`}>
        <span>Crop X</span>
        <input
          id={`x-${safeId}`}
          type="range"
          min="-50"
          max="50"
          step="1"
          value={xValue}
          draggable={false}
          onChange={(e) => onUpdate({ x: Number(e.target.value) })}
        />
      </label>

      <label className="print-control-row" htmlFor={`y-${safeId}`}>
        <span>Crop Y</span>
        <input
          id={`y-${safeId}`}
          type="range"
          min="-50"
          max="50"
          step="1"
          value={yValue}
          draggable={false}
          onChange={(e) => onUpdate({ y: Number(e.target.value) })}
        />
      </label>

      <label className="print-control-row" htmlFor={`z-${safeId}`}>
        <span>Zoom {zoomValue}%</span>
        <input
          id={`z-${safeId}`}
          type="range"
          min="100"
          max="220"
          step="1"
          value={zoomValue}
          draggable={false}
          onChange={(e) => onUpdate({ zoom: Number(e.target.value) })}
        />
      </label>

      {item.type === "video" && (
        <label className="print-control-row" htmlFor={`f-${safeId}`}>
          <span>Frame {frameTime}s</span>
          <input
            id={`f-${safeId}`}
            type="range"
            min="0"
            max="100"
            step="1"
            value={frameValue}
            draggable={false}
            onChange={(e) => onUpdate({ frame: Number(e.target.value) })}
          />
        </label>
      )}
    </div>
  );
}

export default function PrintPage() {
  const site = getSiteConfig();
  const about = getAboutConfig();
  const sections = getOrderedSections("");
  const [showPreviews, setShowPreviews] = useState(true);
  const [mediaAdjustments, setMediaAdjustments] = useState(() => loadMediaAdjustments());
  const [mediaLayoutPrefs, setMediaLayoutPrefs] = useState(() => loadMediaLayoutPrefs());
  const [videoDurations, setVideoDurations] = useState({});
  const [dragSrc, setDragSrc] = useState("");
  const [isSavingPdf, setIsSavingPdf] = useState(false);
  const [pdfProgress, setPdfProgress] = useState({ current: 0, total: 0, status: "" });

  const projects = sections.flatMap((section, sectionIndex) =>
    (section.detailGroups ?? []).map((group, groupIndex) => ({
      section,
      sectionIndex,
      group,
      groupIndex,
    }))
  );
  const aboutParagraphs = normalizeParagraphs(about.paragraphs || site.aboutText || "");
  const totalPages = projects.length + 2;
  const projectStartPage = 2;
  const aboutPageNumber = totalPages;

  const sectionBlocks = sections.map((section) => {
    const entries = projects
      .map((project, projectIndex) => ({ ...project, projectIndex }))
      .filter((project) => project.section.id === section.id)
      .map((project) => ({
        anchor: getProjectAnchor(project.projectIndex),
        projectIndex: project.projectIndex,
        pageNumber: projectStartPage + project.projectIndex,
        title: project.group.title || `Project ${project.groupIndex + 1}`,
      }));

    return {
      section,
      entries,
    };
  }).filter((block) => block.entries.length > 0);

  const aboutBlock = {
    section: { id: "about", title: "About" },
    entries: [{ anchor: "print-about-page", projectIndex: null, pageNumber: aboutPageNumber, title: "About" }],
  };
  const personalProjectsIndex = sectionBlocks.findIndex((block) => block.section.id === "personal-projects");
  if (personalProjectsIndex === -1) {
    sectionBlocks.push(aboutBlock);
  } else {
    sectionBlocks.splice(personalProjectsIndex + 1, 0, aboutBlock);
  }

  const tocColumns = [
    sectionBlocks.slice(0, Math.ceil(sectionBlocks.length / 2)),
    sectionBlocks.slice(Math.ceil(sectionBlocks.length / 2)),
  ];

  useEffect(() => {
    const cleanup = () => document.body.classList.remove("print-prep");
    window.addEventListener("afterprint", cleanup);
    return () => window.removeEventListener("afterprint", cleanup);
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(MEDIA_ADJUSTMENTS_KEY, JSON.stringify(mediaAdjustments));
    } catch {
      // Ignore storage failures silently.
    }
  }, [mediaAdjustments]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MEDIA_LAYOUT_PREFS_KEY, JSON.stringify(mediaLayoutPrefs));
    } catch {
      // Ignore storage failures silently.
    }
  }, [mediaLayoutPrefs]);

  const getAdjustment = (src) => {
    const saved = mediaAdjustments[src] || {};
    return {
      x: Number.isFinite(saved.x) ? saved.x : DEFAULT_MEDIA_ADJUSTMENT.x,
      y: Number.isFinite(saved.y) ? saved.y : DEFAULT_MEDIA_ADJUSTMENT.y,
      zoom: Number.isFinite(saved.zoom) ? saved.zoom : DEFAULT_MEDIA_ADJUSTMENT.zoom,
      frame: Number.isFinite(saved.frame) ? saved.frame : DEFAULT_MEDIA_ADJUSTMENT.frame,
    };
  };

  const updateAdjustment = (src, patch) => {
    setMediaAdjustments((prev) => {
      const current = prev[src] || DEFAULT_MEDIA_ADJUSTMENT;
      const next = {
        x: Number.isFinite(patch.x) ? clamp(patch.x, -50, 50) : current.x,
        y: Number.isFinite(patch.y) ? clamp(patch.y, -50, 50) : current.y,
        zoom: Number.isFinite(patch.zoom) ? clamp(patch.zoom, 100, 220) : current.zoom,
        frame: Number.isFinite(patch.frame) ? clamp(patch.frame, 0, 100) : current.frame,
      };
      return { ...prev, [src]: next };
    });
  };

  const handleDurationChange = (src, duration) => {
    if (!Number.isFinite(duration) || duration <= 0) return;
    setVideoDurations((prev) => {
      if (prev[src] === duration) return prev;
      return { ...prev, [src]: duration };
    });
  };

  const getProjectPrefs = (projectKey, media) => {
    const saved = mediaLayoutPrefs[projectKey] || {};
    const layoutMode = saved.layoutMode === "rows" ? "rows" : DEFAULT_LAYOUT_MODE;
    const mediaLimit = saved.mediaLimit === "auto"
      ? "auto"
      : Number.isFinite(saved.mediaLimit)
        ? clamp(saved.mediaLimit, 1, 4)
        : DEFAULT_MEDIA_LIMIT;
    const savedOrder = Array.isArray(saved.order) ? saved.order : [];
    const savedSelected = Array.isArray(saved.selected) ? saved.selected : [];
    const availableSet = new Set(media.map((item) => item.src));
    const filteredSaved = savedOrder.filter((src) => availableSet.has(src));
    const missing = media.map((item) => item.src).filter((src) => !filteredSaved.includes(src));
    const selectedFiltered = savedSelected.filter((src) => availableSet.has(src));
    const selected = selectedFiltered.length > 0 ? selectedFiltered : media.map((item) => item.src);
    return { layoutMode, mediaLimit, order: [...filteredSaved, ...missing], selected };
  };

  const updateProjectPrefs = (projectKey, patch) => {
    setMediaLayoutPrefs((prev) => {
      const current = prev[projectKey] || { layoutMode: DEFAULT_LAYOUT_MODE, mediaLimit: DEFAULT_MEDIA_LIMIT, order: [], selected: [] };
      const next = {
        layoutMode: patch.layoutMode === "rows" ? "rows" : (patch.layoutMode === "columns" ? "columns" : current.layoutMode),
        mediaLimit: patch.mediaLimit === "auto"
          ? "auto"
          : Number.isFinite(patch.mediaLimit)
            ? clamp(Math.round(patch.mediaLimit), 1, 4)
            : current.mediaLimit,
        order: Array.isArray(patch.order) ? patch.order : current.order,
        selected: Array.isArray(patch.selected) ? patch.selected : current.selected,
      };
      return { ...prev, [projectKey]: next };
    });
  };

  const handleSwapDrop = (projectKey, media, targetSrc) => {
    if (!dragSrc || !targetSrc || dragSrc === targetSrc) {
      setDragSrc("");
      return;
    }

    const prefs = getProjectPrefs(projectKey, media);
    const nextOrder = swapMediaOrder(prefs.order, dragSrc, targetSrc);
    updateProjectPrefs(projectKey, {
      order: nextOrder,
      layoutMode: prefs.layoutMode,
      mediaLimit: prefs.mediaLimit,
      selected: prefs.selected,
    });
    setDragSrc("");
  };

  const handleSavePdf = async () => {
    if (isSavingPdf) return;

    setIsSavingPdf(true);
    setPdfProgress({ current: 0, total: 0, status: "Preparing media" });

    try {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await document.fonts?.ready;
      await waitForPreviewMedia();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      setPdfProgress({ current: 0, total: 0, status: "Opening Save as PDF" });
      window.print();
    } catch (error) {
      console.error("Unable to open the print dialog", error);
      window.alert("The print dialog could not be opened. Please try again after all media previews finish loading.");
    } finally {
      setIsSavingPdf(false);
      setPdfProgress({ current: 0, total: 0, status: "" });
    }
  };

  const handleResetDefaults = () => {
    setMediaAdjustments({});
    setMediaLayoutPrefs({});
    setVideoDurations({});
    setShowPreviews(true);
    setDragSrc("");
    try {
      window.localStorage.removeItem(MEDIA_ADJUSTMENTS_KEY);
      window.localStorage.removeItem(MEDIA_LAYOUT_PREFS_KEY);
    } catch {
      // Ignore storage failures silently.
    }
  };

  return (
    <main className="print-page">
      {isSavingPdf && (
        <div className="pdf-export-progress" role="status" aria-live="polite">
          <div className="pdf-export-progress-card">
            <p>{pdfProgress.status}</p>
            {pdfProgress.total > 0 && <strong>Page {pdfProgress.current} of {pdfProgress.total}</strong>}
            <div className="pdf-export-progress-track" aria-hidden="true">
              <span style={{ width: `${pdfProgress.total ? (pdfProgress.current / pdfProgress.total) * 100 : 8}%` }} />
            </div>
          </div>
        </div>
      )}
      <header className="print-header no-print-break">
        <p className="print-kicker">Portfolio</p>
        <h1>{site.title || "Portfolio"}</h1>
        <p className="print-subtitle">{site.subtitle || "Selected work"}</p>

        <div className="print-actions">
          <Link to="/" className="print-link">Back to site</Link>
          <button type="button" className="print-link" onClick={handleSavePdf} disabled={isSavingPdf}>
            Save PDF
          </button>
          <button type="button" className="print-link print-link--danger" onClick={handleResetDefaults}>
            Reset to default
          </button>
        </div>

        <div className="print-options">
          <label className="print-option" htmlFor="print-show-images">
            <input
              id="print-show-images"
              type="checkbox"
              checked={showPreviews}
              onChange={(e) => setShowPreviews(e.target.checked)}
            />
            Include media previews (images and video first frame)
          </label>
          <p className="print-note">
            One project per 16:9 page, with adaptive image mosaics and bottom-aligned text.
          </p>
          <p className="print-note">
            Use each media slider to adjust horizontal crop and video frame. Settings are saved in your browser.
          </p>
          <p className="print-note">
            In the print dialog, set Destination to "Save as PDF" (not a physical printer or "Microsoft Print to PDF"), Paper size to the custom 16in x 9in option, and Scale to 100% / Default — otherwise the browser will substitute a standard paper size and shrink the page to fit, making everything look smaller than this preview.
          </p>
        </div>
      </header>

      <section className="print-content">
        <article className="print-project-card print-front-card print-toc-card" id="print-contents-page">
          <div className="print-front-inner">
            <p className="print-front-kicker">Contents</p>
            <div className="print-front-header">
            {about.name && <p className="print-about-name">{about.name}</p>}
            <h2>{site.title || "Portfolio"}</h2>
            {normalizeParagraphs(site.aboutText).map((paragraph, idx) => (
              <p key={`front-summary-${idx}`} className="print-front-summary print-front-summary--compact">
                {renderTextWithLinks(paragraph, `front-summary-${idx}`)}
              </p>
            ))}
            </div>

            <div className="print-toc-columns">
              {tocColumns.map((column, columnIndex) => (
                <div key={`toc-column-${columnIndex}`} className="print-toc-column">
                  {column.map(({ section, entries }) => (
                    <section key={`${section.id}-toc`} className="print-toc-block">
                      <h3 className="print-toc-block-title">{section.title}</h3>
                      {section.summary && (
                        <p className="print-toc-block-summary">{section.summary}</p>
                      )}
                      <ol className="print-toc-list">
                        {entries.map((entry) => (
                          <li key={`${entry.anchor}-toc`} className="print-toc-item">
                            <a href={`#${entry.anchor}`} className="print-toc-link">
                              <span className="print-toc-main">
                                {entry.projectIndex !== null
                                  ? `${String(entry.projectIndex + 1).padStart(2, "0")} ${entry.title}`
                                  : entry.title}
                              </span>
                            </a>
                            <span className="print-toc-page">{entry.pageNumber}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>
              ))}
            </div>

            <div className="print-front-footer">
              <span>{site.brand || ""}</span>
              {site.contactEmail && <span>{site.contactEmail}</span>}
            </div>
            <span className="print-page-number">1</span>
          </div>
        </article>

        {projects.map(({ section, sectionIndex, group, groupIndex }, projectIndex) => {
          const description = normalizeParagraphs(group.description);
          const sectionSummary = normalizeParagraphs(section.summary);
          const media = getRenderableMedia(group);
          const projectKey = `${section.id}::${group.id || groupIndex}`;
          const prefs = getProjectPrefs(projectKey, media);
          const orderedMedia = orderMediaByPreference(media, prefs.order);
          const selectedSet = new Set(prefs.selected);
          const selectedMedia = orderedMedia.filter((item) => selectedSet.has(item.src));
          const maxSelectable = Math.max(0, Math.min(4, selectedMedia.length));
          const requestedCount = prefs.mediaLimit === "auto"
            ? maxSelectable
            : clamp(prefs.mediaLimit, 1, Math.max(1, maxSelectable));
          const mediaForPage = selectedMedia.slice(0, requestedCount);
          const mediaRemainder = Math.max(0, selectedMedia.length - mediaForPage.length);
          const layoutClass = getMediaLayoutClass(mediaForPage.length, prefs.layoutMode);
          const flip = projectIndex % 2 === 1;

          return (
            <article
              key={group.id || `${section.id}-${groupIndex}`}
              id={getProjectAnchor(projectIndex)}
              className={`print-project-card${flip ? " print-project-card--flip" : ""}`}
            >
              <div className="print-project-surface">
                <aside className="print-project-media">
                  <div className="print-layout-controls">
                    <div className="print-layout-left">
                      <span className="print-layout-label">Layout</span>
                      <button
                        type="button"
                        className={`print-layout-btn${prefs.layoutMode === "columns" ? " is-active" : ""}`}
                        onClick={() => updateProjectPrefs(projectKey, {
                          layoutMode: "columns",
                          mediaLimit: prefs.mediaLimit,
                          order: prefs.order,
                          selected: prefs.selected,
                        })}
                      >
                        Columns
                      </button>
                      <button
                        type="button"
                        className={`print-layout-btn${prefs.layoutMode === "rows" ? " is-active" : ""}`}
                        onClick={() => updateProjectPrefs(projectKey, {
                          layoutMode: "rows",
                          mediaLimit: prefs.mediaLimit,
                          order: prefs.order,
                          selected: prefs.selected,
                        })}
                      >
                        Rows
                      </button>

                      <label className="print-count-select-wrap">
                        <span className="print-layout-label">Show</span>
                        <select
                          className="print-layout-select"
                          value={String(prefs.mediaLimit)}
                          onChange={(e) => {
                            const next = e.target.value === "auto" ? "auto" : Number(e.target.value);
                            updateProjectPrefs(projectKey, {
                              layoutMode: prefs.layoutMode,
                              mediaLimit: next,
                              order: prefs.order,
                              selected: prefs.selected,
                            });
                          }}
                        >
                          <option value="auto">Auto</option>
                          {Array.from({ length: Math.max(0, Math.min(4, selectedMedia.length)) }, (_, i) => i + 1).map((count) => (
                            <option key={`${projectKey}-count-${count}`} value={count}>
                              {count} image{count === 1 ? "" : "s"}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <details className="print-media-picker print-media-picker--right">
                      <summary className="print-media-picker-summary">
                        Media ({prefs.selected.length}/{media.length})
                      </summary>
                      <div className="print-media-picker-list">
                        {orderedMedia.map((item, mediaIndex) => {
                          const checked = selectedSet.has(item.src);
                          return (
                            <label key={`${projectKey}-pick-${item.src}`} className="print-media-picker-item">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const nextSelected = e.target.checked
                                    ? [...prefs.selected, item.src]
                                    : prefs.selected.filter((src) => src !== item.src);
                                  updateProjectPrefs(projectKey, {
                                    layoutMode: prefs.layoutMode,
                                    mediaLimit: prefs.mediaLimit,
                                    order: prefs.order,
                                    selected: nextSelected,
                                  });
                                }}
                              />
                              <span>{getMediaLabel(item, mediaIndex)}</span>
                            </label>
                          );
                        })}
                      </div>
                    </details>
                  </div>

                  {showPreviews ? (
                    <div className={`print-media-grid ${layoutClass}`}>
                      {mediaForPage.length === 0 && (
                        <div className="print-media-placeholder">No media</div>
                      )}
                      {mediaForPage.map((item, idx) => (
                        <figure
                          key={`${group.id || groupIndex}-media-${idx}`}
                          className={`print-media-cell print-media-cell--${idx + 1}`}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={() => handleSwapDrop(projectKey, media, item.src)}
                        >
                          <MediaSquare
                            item={item}
                            fallbackAlt={group.title || "Project preview"}
                            xOffset={getAdjustment(item.src).x}
                            yOffset={getAdjustment(item.src).y}
                            zoom={getAdjustment(item.src).zoom}
                            framePercent={getAdjustment(item.src).frame}
                            onDurationChange={(duration) => handleDurationChange(item.src, duration)}
                          />
                          <MediaAdjustControls
                            item={item}
                            adjustment={getAdjustment(item.src)}
                            onUpdate={(patch) => updateAdjustment(item.src, patch)}
                            durationSeconds={videoDurations[item.src] || 0}
                          />
                          <button
                            type="button"
                            className="print-drag-handle"
                            draggable
                            onDragStart={() => setDragSrc(item.src)}
                            onDragEnd={() => setDragSrc("")}
                            aria-label="Drag to swap media"
                          >
                            Drag to swap
                          </button>
                        </figure>
                      ))}
                      {mediaRemainder > 0 && (
                        <div className="print-media-more">+{mediaRemainder} more</div>
                      )}
                    </div>
                  ) : (
                    <div className="print-media-grid print-media-grid--empty">
                      <div className="print-media-placeholder">Preview hidden</div>
                    </div>
                  )}
                </aside>

                <section className="print-project-text">
                  <div className="print-project-top">
                    <p className="print-project-index">{String(projectIndex + 1).padStart(2, "0")}</p>
                    <p className="print-project-section">{section.title}</p>
                    <h2>{group.title || `Project ${groupIndex + 1}`}</h2>
                  </div>

                  <div className="print-project-bottom">
                    {/* <p className="print-meta">
                      {`Section ${String(sectionIndex + 1).padStart(2, "0")}`}
                    </p> */}

                    {description.length > 0
                      ? description.slice(0, 5).map((paragraph, i) => (
                        <p key={`${section.id}-${group.id || groupIndex}-desc-${i}`} className="print-desc">{paragraph}</p>
                      ))
                      : sectionSummary.slice(0, 5).map((paragraph, i) => (
                        <p key={`${section.id}-${group.id || groupIndex}-summary-${i}`} className="print-desc">{paragraph}</p>
                      ))}
                  </div>
                </section>
              </div>
              <span className="print-page-number">{projectStartPage + projectIndex}</span>
            </article>
          );
        })}

        <article className="print-project-card print-front-card print-about-card" id="print-about-page">
          <div className="print-front-inner print-about-inner">
            <div className="print-about-layout">
              <section className="print-about-copy">
                <div className="print-about-header">
                  <p className="print-front-kicker">About</p>
                  {about.name && <p className="print-about-name">{about.name}</p>}
                </div>

                {(aboutParagraphs.length ? aboutParagraphs : [site.aboutText || ""]).slice(0, 3).map((paragraph, idx) => (
                  <p key={`about-${idx}`} className="print-front-summary print-front-summary--about">{paragraph}</p>
                ))}

                <div className="print-about-contact">
                  {about.location && (
                    <div className="print-about-contact-row print-about-contact-row--single">
                      <span className="print-about-contact-value">{about.location}</span>
                    </div>
                  )}
                  {about.phone && (
                    <div className="print-about-contact-row">
                      <span className="print-about-contact-label">Phone</span>
                      <span className="print-about-contact-value">{about.phone}</span>
                    </div>
                  )}
                  {site.contactEmail && (
                    <div className="print-about-contact-row">
                      <span className="print-about-contact-label">Email</span>
                      <span className="print-about-contact-value">{site.contactEmail}</span>
                    </div>
                  )}
                </div>
              </section>

              <section className="print-about-side">
                <div className="print-about-images">
                  {(Array.isArray(about.images) ? about.images : []).slice(0, 2).map((item, idx) => (
                    <figure key={`about-image-${idx}`} className="print-about-image-frame">
                      <MediaSquare
                        item={{ type: "image", src: item.src, alt: item.alt || "About image" }}
                        fallbackAlt="About image"
                        xOffset={getAdjustment(item.src).x}
                        yOffset={getAdjustment(item.src).y}
                        zoom={getAdjustment(item.src).zoom}
                        framePercent={getAdjustment(item.src).frame}
                      />
                      <MediaAdjustControls
                        item={{ type: "image", src: item.src, alt: item.alt || "About image" }}
                        adjustment={getAdjustment(item.src)}
                        onUpdate={(patch) => updateAdjustment(item.src, patch)}
                        durationSeconds={0}
                      />
                    </figure>
                  ))}
                </div>

                <div className="print-about-capabilities">
                  <div className="print-about-skills">
                    <p className="print-about-mini-title">Core Competencies</p>
                    <ul className="print-about-skill-list">
                      {(Array.isArray(about.skills) ? about.skills : []).map((skill, idx) => (
                        <li key={`about-skill-${idx}`}>{skill}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="print-about-software">
                    <p className="print-about-mini-title">Software / Technologies</p>
                    <div className="print-about-software-grid">
                      {(Array.isArray(about.software) ? about.software : []).map((tool, idx) => (
                        <div key={`about-tool-${idx}`} className="print-about-software-item">
                          {tool.src && <img src={tool.src} alt={tool.name || "Software logo"} loading="eager" decoding="async" />}
                          <span>{tool.name || "Tool"}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            </div>

          </div>
          <span className="print-page-number">{aboutPageNumber}</span>
        </article>
      </section>
    </main>
  );
}
