import { AnimatePresence, animate, motion, useMotionValue, useSpring, useTransform } from "framer-motion";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getOrderedSections, getSiteConfig } from "../lib/content";
import { useCursor } from "../lib/cursor";
import { useAbout } from "../components/AboutOverlay";

const PIXELS_PER_SECTION = 350;
const SNAP_DELAY_MS = 160;
const PARALLAX_VH = 30;
const SPRING = { stiffness: 82, damping: 22, mass: 0.8 };
const DETAIL_INTRO_HOLD_MS = 220;
const DETAIL_INTRO_MORPH_MS = 720;
const DETAIL_CLOSE_PULL_THRESHOLD_PX = 450;
const DETAIL_CLOSE_PULL_GAIN = 0.42;
// Pause (ms) between wheel events that counts as the end of one scroll gesture.
const WHEEL_GESTURE_IDLE_MS = 220;
const UNSUPPORTED_IMAGE_EXT = new Set(["heic", "heif"]);
const SUPPORTED_VIDEO_EXT = new Set(["mp4", "webm", "ogv", "ogg"]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, t) {
  return start + (end - start) * t;
}

// Square media size; larger on mobile so one picture fills the column. Must match --detail-img in CSS.
function mediaItemPx(w, h) {
  return w <= 900
    ? Math.max(1, Math.min(w * 0.86, h * 0.56))
    : Math.max(1, Math.min(w * 0.44, h * 0.72));
}

// Hide a broken image and its frame so a missing source appears absent instead of erroring.
function hideBrokenMedia(e) {
  const el = e.currentTarget;
  el.style.display = "none";
  const frame = el.closest(".dframe, .dhero-frame");
  if (frame) frame.style.visibility = "hidden";
}

function easeOutCubic(t) {
  return 1 - (1 - t) * (1 - t) * (1 - t);
}

function renderTextBlocks(text) {
  const paragraphs = Array.isArray(text)
    ? text
    : typeof text === "string"
      ? text.split(/\n\s*\n/)
      : [];

  return paragraphs
    .filter((paragraph) => typeof paragraph === "string" && paragraph.trim().length > 0)
    .map((paragraph, index) => (
      <p key={`${paragraph.slice(0, 24)}-${index}`} className="ddesc">{paragraph.trim()}</p>
    ));
}

function SummaryText({ text, className = "info-summary", style = {} }) {
  return (
    <div className={className} style={style}>
      {renderTextBlocks(text)}
    </div>
  );
}

function getFileExt(src = "") {
  const clean = src.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  if (dot === -1) return "";
  return clean.slice(dot + 1).toLowerCase();
}

function isRenderableMedia(item) {
  if (!item || !item.src || !item.type) return false;
  const ext = getFileExt(item.src);

  if (item.type === "image") {
    if (!ext) return true;
    return !UNSUPPORTED_IMAGE_EXT.has(ext);
  }

  if (item.type === "video") {
    if (!ext) return true;
    return SUPPORTED_VIDEO_EXT.has(ext);
  }

  return false;
}

function flattenSectionMedia(section) {
  const groups = section?.detailGroups ?? [];
  return groups.flatMap((group) =>
    (group.media ?? []).map((item) => ({
      ...item,
      label: group.title || "",
      description: item.description || group.description || section.summary || "",
    }))
  ).filter(isRenderableMedia);
}

function getSectionHeroItem(section) {
  return flattenSectionMedia(section)[0] || null;
}

// Cache one <video> element per src so it survives React unmount/remount.
// Moving the same element between the index hero and the detail hero keeps
// playback position intact, so opening/closing a section never restarts it.
const persistentVideoCache = new Map();

function getPersistentVideo(src) {
  let el = persistentVideoCache.get(src);
  if (!el) {
    el = document.createElement("video");
    el.src = src;
    el.muted = true;
    el.loop = true;
    el.autoplay = true;
    el.playsInline = true;
    el.setAttribute("muted", "");
    el.setAttribute("playsinline", "");
    el.preload = "auto";
    persistentVideoCache.set(src, el);
  }
  return el;
}

function PersistentVideo({ src, className = "", isActive = false }) {
  const hostRef = useRef(null);

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host || !src) return undefined;
    const el = getPersistentVideo(src);
    el.className = className;
    host.appendChild(el);
    return () => {
      // Detach but keep the element alive so currentTime is preserved.
      if (el.parentNode === host) host.removeChild(el);
    };
    // Intentionally exclude className so re-classing never re-appends the element.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const el = persistentVideoCache.get(src);
    if (!el) return;
    el.className = className;
    if (isActive) {
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === "function") playPromise.catch(() => {});
    } else {
      el.pause();
    }
  }, [src, className, isActive]);

  return <span ref={hostRef} className="persistent-video-host" style={{ display: "contents" }} />;
}

function preloadImages(sections) {
  sections.forEach((section) => {
    const heroItem = getSectionHeroItem(section);
    if (heroItem?.type === "image") {
      const img = new Image();
      img.src = heroItem.src;
    }
  });
}

function preloadMediaAroundIndex(media, activeIndex, count = 2) {
  for (let i = 0; i <= count; i += 1) {
    const item = media[activeIndex + i];
    if (item?.type === "image") {
      const img = new Image();
      img.src = item.src;
    }
  }
}

function InlineSectionExperience({ section, sectionIndex, heroOnLeft, site, onClose, isActive = false, sourceParallaxPx = 0, sourceSummaryTop = null, sourceHeroTop = null }) {
  const scrollRef = useRef(null);
  const [closePull, setClosePull] = useState(0);
  const closePullRef = useRef(0);
  const rawMediaPos = useMotionValue(0);
  const mediaSpring = useSpring(rawMediaPos, SPRING);
  const initialTrackDims = (() => {
    if (typeof window === "undefined") return { step: 0, center: 0 };
    const itemPx = mediaItemPx(window.innerWidth, window.innerHeight);
    return { step: itemPx * 1.14, center: (window.innerHeight - itemPx) / 2 };
  })();
  const mediaTrackY = useMotionValue(initialTrackDims.center);
  const trackDims = useRef(initialTrackDims);
  const freeMediaPos = useRef(0);
  const snapTimerRef = useRef(null);
  const [viewport, setViewport] = useState(() => ({
    w: typeof window !== "undefined" ? window.innerWidth : 0,
    h: typeof window !== "undefined" ? window.innerHeight : 0,
  }));
  const [introProgress, setIntroProgress] = useState(0);
  const [introDone, setIntroDone] = useState(false);
  const [closeT, setCloseT] = useState(0);
  const [activeMediaIndex, setActiveMediaIndex] = useState(0);
  const closingRef = useRef(false);

  // Copy column: overflowing description scrolls on its own before media advances.
  const copyScrollRef = useRef(null);
  const copySideRef = useRef(null);
  const touchInCopyRef = useRef(false);
  const lastTouchYRef = useRef(0);
  const [copyScrollState, setCopyScrollState] = useState({ overflow: false, atTop: true, atBottom: true });
  // Mobile: description is collapsed by default; toggles between photo view and text view.
  const [mobileCopyOpen, setMobileCopyOpen] = useState(false);
  const mobileCopyOpenRef = useRef(false);
  mobileCopyOpenRef.current = mobileCopyOpen;

  const { setLabel } = useCursor();
  const { open: aboutOpen, openAbout } = useAbout();
  useEffect(() => {
    setLabel(aboutOpen ? "" : "Close");
    return () => setLabel("");
  }, [setLabel, aboutOpen]);

  const summaryRef = useRef(null);
  const summaryY = useMotionValue(0);
  useLayoutEffect(() => {
    const el = summaryRef.current;
    if (!el || sourceSummaryTop == null) return;
    // Start the summary exactly where it sat in the index, then glide to the top.
    const startY = sourceSummaryTop - el.getBoundingClientRect().top;
    summaryY.set(startY);
    const controls = animate(summaryY, 0, { duration: 0.55, ease: [0.65, 0, 0.35, 1] });
    return () => controls.stop();
  }, [section.id, sourceSummaryTop, summaryY]);

  const heroFrameRef = useRef(null);

  // Reverse the open sequence: return to the first picture, then re-expand the hero.
  const runClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    closePullRef.current = 0;
    setClosePull(0);
    if (!introDone) {
      onClose();
      return;
    }
    const startMorph = () => {
      if (sourceSummaryTop != null && summaryRef.current) {
        const targetY = sourceSummaryTop - summaryRef.current.getBoundingClientRect().top;
        animate(summaryY, targetY, { duration: 0.5, ease: [0.65, 0, 0.35, 1] });
      }
      animate(0, 1, {
        duration: 0.5,
        ease: [0.65, 0, 0.35, 1],
        onUpdate: (v) => setCloseT(v),
        onComplete: () => onClose(),
      });
    };
    if (freeMediaPos.current > 0.01) {
      // Scale the return-scroll by distance (capped) so long sections don't snap back too fast.
      const returnDuration = clamp(freeMediaPos.current * 0.28, 0.6, 2.6);
      animate(freeMediaPos.current, 0, {
        duration: returnDuration,
        ease: [0.65, 0, 0.35, 1],
        onUpdate: (v) => {
          freeMediaPos.current = v;
          rawMediaPos.set(v);
        },
        onComplete: startMorph,
      });
    } else {
      startMorph();
    }
  }, [introDone, onClose, sourceSummaryTop, summaryY, rawMediaPos]);

  const media = useMemo(() => flattenSectionMedia(section), [section]);
  const heroItem = media[0] ?? null;
  const trailMedia = media.slice(1);

  useEffect(() => {
    const updateViewport = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => window.removeEventListener("resize", updateViewport);
  }, []);

  // Center the active picture and keep even spacing so neighbours peek in above/below.
  useEffect(() => {
    const itemPx = mediaItemPx(viewport.w, viewport.h);
    trackDims.current = { step: itemPx * 1.14, center: (viewport.h - itemPx) / 2 };
    mediaTrackY.set(trackDims.current.center - mediaSpring.get() * trackDims.current.step);
  }, [viewport, mediaSpring, mediaTrackY]);

  useEffect(() => {
    const apply = (t) => mediaTrackY.set(trackDims.current.center - t * trackDims.current.step);
    apply(mediaSpring.get());
    return mediaSpring.on("change", apply);
  }, [mediaSpring, mediaTrackY]);

  useLayoutEffect(() => {
    freeMediaPos.current = 0;
    rawMediaPos.set(0);
    closePullRef.current = 0;
    setClosePull(0);
  }, [section.id, rawMediaPos]);

  useEffect(() => {
    freeMediaPos.current = 0;
    rawMediaPos.set(0);
    setActiveMediaIndex(0);
    closePullRef.current = 0;
    setClosePull(0);
    setIntroProgress(0);
    setIntroDone(false);

    const start = performance.now();
    const total = DETAIL_INTRO_HOLD_MS + DETAIL_INTRO_MORPH_MS;
    let raf = 0;

    const tick = (now) => {
      const elapsed = now - start;
      if (elapsed <= DETAIL_INTRO_HOLD_MS) {
        setIntroProgress(0);
      } else {
        const t = clamp((elapsed - DETAIL_INTRO_HOLD_MS) / DETAIL_INTRO_MORPH_MS, 0, 1);
        setIntroProgress(easeOutCubic(t));
      }

      if (elapsed < total) {
        raf = requestAnimationFrame(tick);
      } else {
        setIntroProgress(1);
        setIntroDone(true);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [section.id]);

  const activeItem = media[activeMediaIndex] || heroItem;
  const closeProgress = clamp(Math.abs(closePull) / DETAIL_CLOSE_PULL_THRESHOLD_PX, 0, 1);
  const closeProgressValue = useMotionValue(0);
  const closeProgressSmooth = useSpring(closeProgressValue, { stiffness: 240, damping: 30, mass: 0.35 });
  const closeFillClip = useTransform(closeProgressSmooth, (v) => `inset(0 ${100 - v * 100}% 0 0)`);
  const closeDirection = Math.abs(closePull) > 2 ? (closePull < 0 ? "up" : "down") : null;
  const closeLabel = closeDirection === "down" ? "SCROLL DOWN TO CLOSE" : "SCROLL UP TO CLOSE";

  useEffect(() => {
    closeProgressValue.set(closeProgress);
  }, [closeProgress, closeProgressValue]);

  const handleEdgeClosePull = useCallback((delta) => {
    if (!introDone || closingRef.current) return;
    const lastIndex = Math.max(0, media.length - 1);
    const atTop = freeMediaPos.current <= 0.001;
    const atBottom = freeMediaPos.current >= lastIndex - 0.001;

    let next = closePullRef.current;
    if (atBottom && delta > 0) {
      next = Math.min(DETAIL_CLOSE_PULL_THRESHOLD_PX, next + delta * DETAIL_CLOSE_PULL_GAIN);
    } else if (atTop && delta < 0) {
      next = Math.max(-DETAIL_CLOSE_PULL_THRESHOLD_PX, next + delta * DETAIL_CLOSE_PULL_GAIN);
    } else {
      next = 0;
    }

    closePullRef.current = next;
    setClosePull(next);

    if (Math.abs(next) >= DETAIL_CLOSE_PULL_THRESHOLD_PX) runClose();
  }, [introDone, media.length, runClose]);

  // Wheel/touch drive a spring-smoothed picture position, then snap to the nearest.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return undefined;
    const lastIndex = Math.max(0, media.length - 1);

    const snap = () => {
      const nearest = clamp(Math.round(freeMediaPos.current), 0, lastIndex);
      freeMediaPos.current = nearest;
      rawMediaPos.set(nearest);
      setActiveMediaIndex(nearest);
    };

    const stepTo = (pos) => {
      freeMediaPos.current = clamp(pos, 0, lastIndex);
      rawMediaPos.set(freeMediaPos.current);
      setActiveMediaIndex(clamp(Math.round(freeMediaPos.current), 0, lastIndex));
    };

    // A gesture may only trigger the close pull if it *started* at the edge, so a fast
    // scroll through the media can't roll straight into closing the section.
    let lastWheelAt = 0;
    let gestureStartedAtTop = false;
    let gestureStartedAtBottom = false;

    const onWheel = (e) => {
      if (!introDone || closingRef.current) {
        e.preventDefault();
        return;
      }
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;

      const now = e.timeStamp || performance.now();
      if (now - lastWheelAt > WHEEL_GESTURE_IDLE_MS) {
        gestureStartedAtTop = freeMediaPos.current <= 0.001;
        gestureStartedAtBottom = freeMediaPos.current >= lastIndex - 0.001;
      }
      lastWheelAt = now;

      // Let the browser natively scroll the overflowing description when the pointer is over it.
      const scroller = copyScrollRef.current;
      if (scroller && scroller.contains(e.target)) {
        const canDown = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
        const canUp = scroller.scrollTop > 1;
        if ((delta > 0 && canDown) || (delta < 0 && canUp)) {
          return; // no preventDefault → native, smooth text scroll
        }
      }

      // Mobile text view: only the current description scrolls; pictures never advance.
      if (mobileCopyOpenRef.current) {
        e.preventDefault();
        return;
      }

      e.preventDefault();
      const atTop = freeMediaPos.current <= 0.001;
      const atBottom = freeMediaPos.current >= lastIndex - 0.001;
      if ((atTop && delta < 0) || (atBottom && delta > 0)) {
        if ((delta < 0 && gestureStartedAtTop) || (delta > 0 && gestureStartedAtBottom)) {
          handleEdgeClosePull(delta);
        }
        return;
      }
      if (closePullRef.current !== 0) {
        closePullRef.current = 0;
        setClosePull(0);
      }
      stepTo(freeMediaPos.current + delta / PIXELS_PER_SECTION);
      clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(snap, SNAP_DELAY_MS);
    };

    let touchY = null;
    let touchStartPos = 0;
    const onTouchStart = (e) => {
      touchY = e.touches[0].clientY;
      touchStartPos = freeMediaPos.current;
      lastTouchYRef.current = touchY;
      touchInCopyRef.current = !!(copySideRef.current && copySideRef.current.contains(e.target));
      clearTimeout(snapTimerRef.current);
    };
    const onTouchMove = (e) => {
      if (touchY === null || !introDone || closingRef.current) return;
      const currentY = e.touches[0].clientY;

      // Mobile text view: let the overlay scroll natively; never advance pictures.
      if (mobileCopyOpenRef.current) {
        lastTouchYRef.current = currentY;
        return;
      }

      // Let the browser natively scroll the description when the touch began over it.
      const scroller = copyScrollRef.current;
      if (touchInCopyRef.current && scroller && scroller.contains(e.target)) {
        const inc = lastTouchYRef.current - currentY;
        const canDown = scroller.scrollTop + scroller.clientHeight < scroller.scrollHeight - 1;
        const canUp = scroller.scrollTop > 1;
        if ((inc > 0 && canDown) || (inc < 0 && canUp)) {
          lastTouchYRef.current = currentY;
          return; // native touch scroll of the copy column
        }
        // Reached a text edge — hand off to media without a positional jump.
        touchInCopyRef.current = false;
        touchStartPos = freeMediaPos.current;
        touchY = currentY;
      }
      lastTouchYRef.current = currentY;

      const delta = touchY - currentY;
      const atTop = touchStartPos <= 0.001;
      const atBottom = touchStartPos >= lastIndex - 0.001;
      if ((atTop && delta < 0) || (atBottom && delta > 0)) {
        handleEdgeClosePull(delta * 0.6);
        return;
      }
      stepTo(touchStartPos + delta / (window.innerHeight * 0.7));
    };
    const onTouchEnd = () => {
      touchY = null;
      clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(snap, 80);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: true });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      clearTimeout(snapTimerRef.current);
    };
  }, [introDone, media.length, rawMediaPos, handleEdgeClosePull]);

  useEffect(() => {
    preloadMediaAroundIndex(media, activeMediaIndex, 2);
  }, [media, activeMediaIndex]);

  // Reset copy scroll for each picture and track edges so the fade only shows when there is more to read.
  useEffect(() => {
    const el = copyScrollRef.current;
    if (!el) return undefined;
    el.scrollTop = 0;
    const update = () => {
      const overflow = el.scrollHeight - el.clientHeight > 2;
      const atTop = el.scrollTop <= 2;
      const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 2;
      setCopyScrollState((prev) =>
        prev.overflow === overflow && prev.atTop === atTop && prev.atBottom === atBottom
          ? prev
          : { overflow, atTop, atBottom }
      );
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [activeMediaIndex, viewport, introDone, mobileCopyOpen]);

  // Collapse the mobile text back to photo view when the section changes.
  useEffect(() => {
    setMobileCopyOpen(false);
  }, [section.id]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        runClose();
        return;
      }
      if (!introDone) return;
      const lastIndex = Math.max(0, media.length - 1);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const dir = e.key === "ArrowDown" ? 1 : -1;
        const next = clamp(Math.round(freeMediaPos.current) + dir, 0, lastIndex);
        freeMediaPos.current = next;
        rawMediaPos.set(next);
        setActiveMediaIndex(next);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [runClose, introDone, media.length, rawMediaPos]);

  const heroProgress = introDone ? 1 - closeT : introProgress;
  const closing = closeT > 0;
  const summaryCollapsed = !closing && (introProgress > 0 || introDone);
  const squareSize = mediaItemPx(viewport.w, viewport.h);
  const fullWidth = Math.max(squareSize, viewport.w * 0.5);
  const fullHeight = Math.max(squareSize, viewport.h);
  const transitionT = clamp(heroProgress, 0, 1);
  const frameWidth = lerp(fullWidth, squareSize, transitionT);
  const frameHeight = lerp(fullHeight, squareSize, transitionT);
  const frameRadius = lerp(0, 2, transitionT);
  const maxStartOffset = viewport.h * 0.24;
  const heroImageStartY = clamp(sourceParallaxPx, -maxStartOffset, maxStartOffset);
  const heroImageY = lerp(heroImageStartY, 0, transitionT);
  const heroInnerTop = lerp(-24, 0, transitionT);
  const heroInnerHeight = lerp(148, 100, transitionT);
  // The full-bleed hero sits at viewport top, so anchor the morph start to the index hero's position.
  const heroLiftStart = sourceHeroTop != null ? sourceHeroTop : 0;
  const heroLift = lerp(heroLiftStart, 0, transitionT);

  // On mobile, hide the redundant summary once past the first picture.
  const collapseSummary = viewport.w <= 900 && activeMediaIndex > 0;

  return (
    <div
      ref={scrollRef}
      className={`detail-page inline-detail ${heroOnLeft ? "inline-detail--media-left" : "inline-detail--media-right"} ${introDone ? "" : "detail-page--intro"}${mobileCopyOpen ? " is-copy-open" : ""}`}
      onClick={() => runClose()}
    >
      <motion.div
        className={`detail-close-hint${closeDirection ? " is-active" : ""}${closeDirection === "down" ? " detail-close-hint--down" : ""}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: closeDirection ? clamp(0.45 + closeProgress * 0.55, 0, 1) : 0 }}
        transition={{ duration: 0.14, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="detail-close-text" aria-hidden="true">
          <span className="detail-close-text-base">{closeLabel}</span>
          <motion.span className="detail-close-text-fill" style={{ clipPath: closeFillClip }}>
            {closeLabel}
          </motion.span>
        </div>
      </motion.div>

      <nav
        className="index-nav"
        onClick={(e) => e.stopPropagation()}
        onMouseEnter={() => setLabel("")}
        onMouseLeave={() => setLabel(aboutOpen ? "" : "Close")}
      >
        <div className="detail-crumb">
          <button className="brand-btn crumb-index" onClick={runClose}>Index</button>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">{section.title}</span>
        </div>
        <button className="nav-info" onClick={openAbout}>( About )</button>
      </nav>

      {!heroItem && (
        <div className="drow-empty">
          <p>No media found - add images to portfolio.content.json</p>
        </div>
      )}

      {heroItem && (
        <>
          <aside className="inline-copy-side" ref={copySideRef} onClick={(e) => e.stopPropagation()}>
            <div className="inline-copy-sticky">
              <div
                ref={copyScrollRef}
                className={`inline-copy-main${copyScrollState.overflow && !copyScrollState.atBottom ? " fade-bottom" : ""}${copyScrollState.overflow && !copyScrollState.atTop ? " fade-top" : ""}`}
              >
                {section.summary && (
                  <div className={`inline-intro${collapseSummary ? " inline-intro--collapsed" : ""}`}>
                    <motion.div
                      ref={summaryRef}
                      className="ddesc-block"
                      style={{ y: summaryY }}
                    >
                      <SummaryText text={section.summary} className={`info-summary${summaryCollapsed ? " collapsed" : ""}`} />
                    </motion.div>
                  </div>
                )}

                <motion.div
                  className="inline-active-copy"
                  initial={{ opacity: 0, y: 12 }}
                  animate={closing ? { opacity: 0, y: 12 } : { opacity: 1, y: 0 }}
                  transition={{ duration: closing ? 0.3 : 0.4, delay: closing ? 0 : 0.45, ease: [0.45, 0, 0.55, 1] }}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={`${activeItem?.label || ""}::${activeItem?.description || section.summary || ""}`}
                      className="dgroup-copy"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 0.28, ease: [0.45, 0, 0.55, 1] }}
                    >
                      {activeItem?.label && <p className="dgroup-label">{activeItem.label}</p>}
                      {renderTextBlocks(activeItem?.description || section.summary || "")}
                    </motion.div>
                  </AnimatePresence>
                </motion.div>
              </div>

              <div className="info-footer detail-info-footer">
                <span className="info-num">{String(sectionIndex + 1).padStart(2, "0")}</span>
                <span className="info-title">{section.title}</span>
                <motion.span
                  className="ditem-num"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: introDone && !closing ? 1 : 0 }}
                  transition={{ duration: 0.35, ease: [0.45, 0, 0.55, 1] }}
                >
                  {String(activeMediaIndex + 1).padStart(2, "0")} / {String(media.length).padStart(2, "0")}
                </motion.span>
              </div>

              <button
                type="button"
                className="copy-toggle"
                aria-expanded={mobileCopyOpen}
                onClick={(e) => {
                  e.stopPropagation();
                  setMobileCopyOpen((open) => !open);
                }}
              >
                {mobileCopyOpen ? "View photos" : "Read description"}
              </button>
            </div>
          </aside>

          <section className="inline-media-side">
            <motion.div className="inline-media-track" style={{ y: mediaTrackY }}>
              <div className="media-page media-page--hero">
                <div
                  ref={heroFrameRef}
                  className="dhero-frame"
                  style={{
                    width: `${frameWidth}px`,
                    height: `${frameHeight}px`,
                    borderRadius: `${frameRadius}px`,
                    transform: `translateY(${heroLift}px)`,
                  }}
                >
                  <div
                    className="dhero-inner"
                    style={{
                      top: `${heroInnerTop}%`,
                      height: `${heroInnerHeight}%`,
                      transform: `translateY(${heroImageY}px)`,
                    }}
                  >
                    {heroItem.type === "video" ? (
                      <PersistentVideo src={heroItem.src} isActive={isActive} />
                    ) : (
                      <img src={heroItem.src} alt={heroItem.alt || ""} loading="eager" onError={hideBrokenMedia} />
                    )}
                  </div>
                </div>
              </div>

              {trailMedia.map((item, idx) => (
                <div className="media-page" key={`${idx + 1}-${item.src}`}>
                  <div className="dframe">
                    <div className="dframe-media-wrap">
                      {item.type === "video" ? (
                        <PersistentVideo src={item.src} isActive={isActive} />
                      ) : (
                        <img src={item.src} alt={item.alt || ""} loading={idx + 1 <= activeMediaIndex + 2 ? "eager" : "lazy"} onError={hideBrokenMedia} />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </motion.div>
          </section>
        </>
      )}

      {heroItem && media.length > 1 && introDone && !closing && (
        <div className="detail-dot-nav" onClick={(e) => e.stopPropagation()}>
          {media.map((item, idx) => (
            <button
              key={`${idx}-${item.src}`}
              type="button"
              className={`dot${idx === activeMediaIndex ? " dot--active" : ""}`}
              onClick={() => {
                freeMediaPos.current = idx;
                rawMediaPos.set(idx);
                setActiveMediaIndex(idx);
              }}
              aria-label={`Image ${idx + 1}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function HeroPanel({ section, slideIndex, smoothTarget, onOpen, isActive = false }) {
  const imgY = useTransform(smoothTarget, (t) => {
    const viewportHeight = typeof window !== "undefined" ? window.innerHeight : 0;
    return Math.round(((t - slideIndex) * PARALLAX_VH * viewportHeight) / 100);
  });
  const item = getSectionHeroItem(section);

  return (
    <button className="side side-hero" type="button" onClick={onOpen} tabIndex={-1}>
      <div className="hero-inner">
        <div className="dhero-frame dhero-frame--index">
          {!item ? (
            <div className="hero-empty" />
          ) : item.type === "video" ? (
            <motion.div className="dhero-inner dhero-inner--index" style={{ y: imgY }}>
              <PersistentVideo src={item.src} className="hero-img" isActive={isActive} />
            </motion.div>
          ) : (
            <motion.div className="dhero-inner dhero-inner--index" style={{ y: imgY }}>
              <img className="hero-img" src={item.src} alt={item.alt || ""} onError={hideBrokenMedia} />
            </motion.div>
          )}
        </div>
      </div>
    </button>
  );
}

function InfoPanel({ section, sectionIndex, smoothTarget, onOpen }) {
  // Counter the slider's vh-based translation in the SAME unit so the summary
  // is perfectly locked in place (no drift), then fade only near the boundary.
  const summaryY = useTransform(smoothTarget, (t) => `${(t - sectionIndex) * 100}vh`);
  const summaryOpacity = useTransform(smoothTarget, (t) => {
    const a = Math.abs(sectionIndex - t);
    const x = clamp((a - 0.3) / 0.2, 0, 1); // 0 while within the section, 1 at the edge
    return 1 - x * x * (3 - 2 * x); // smoothstep fade, full plateau around centre
  });

  return (
    <button className="side side-info" type="button" onClick={onOpen}>
      <div className="info-body">
        {section.summary && (
          <motion.div
            className="info-summary-pin"
            style={{ y: summaryY, opacity: summaryOpacity }}
          >
            <SummaryText text={section.summary} className="info-summary" />
          </motion.div>
        )}
      </div>
      <div className="info-footer">
        <span className="info-num">{String(sectionIndex + 1).padStart(2, "0")}</span>
        <span className="info-title">{section.title}</span>
      </div>
    </button>
  );
}

export default function HomePage() {
  const location = useLocation();
  const sections = useMemo(() => getOrderedSections(location.search), [location.search]);
  const site = getSiteConfig();

  const { setLabel } = useCursor();
  const { open: aboutOpen, openAbout } = useAbout();

  const [activeIndex, setActiveIndex] = useState(0);
  const [isScrolling, setIsScrolling] = useState(false);
  const [openSectionState, setOpenSectionState] = useState(null);

  const rawTarget = useMotionValue(0);
  const smoothTarget = useSpring(rawTarget, SPRING);
  const sliderY = useTransform(smoothTarget, (t) => `${-t * 100}vh`);

  const freePos = useRef(0);
  const snapTimer = useRef(null);

  useEffect(() => {
    preloadImages(sections);
  }, [sections]);

  const snapToNearest = useCallback(() => {
    const nearest = Math.round(Math.max(0, Math.min(sections.length - 1, freePos.current)));
    freePos.current = nearest;
    setActiveIndex(nearest);
    setIsScrolling(false);
    rawTarget.set(nearest);
  }, [sections.length, rawTarget]);

  const goTo = useCallback((next) => {
    if (next < 0 || next >= sections.length) return;
    clearTimeout(snapTimer.current);
    freePos.current = next;
    setActiveIndex(next);
    setIsScrolling(false);
    rawTarget.set(next);
  }, [sections.length, rawTarget]);

  const openSection = useCallback((idx) => {
    const sourceParallaxPx = ((idx - smoothTarget.get()) * PARALLAX_VH * window.innerHeight) / 100;
    const summaryEl = document.querySelectorAll(".side-info .info-summary")[idx];
    const sourceSummaryTop = summaryEl ? summaryEl.getBoundingClientRect().top : null;
    const heroEl = document.querySelectorAll(".dhero-frame--index")[idx];
    const sourceHeroTop = heroEl ? heroEl.getBoundingClientRect().top : null;
    setOpenSectionState({ index: idx, sourceParallaxPx, sourceSummaryTop, sourceHeroTop });
  }, [smoothTarget]);

  const closeSection = useCallback(() => {
    setOpenSectionState(null);
  }, []);

  const openSectionIndex = openSectionState?.index ?? null;
  const openedSection = openSectionIndex === null ? null : sections[openSectionIndex];
  const openedSectionOnLeft = openSectionIndex === null ? true : openSectionIndex % 2 === 0;
  const activeSectionId = openSectionIndex !== null ? (openedSection?.id ?? null) : (sections[activeIndex]?.id ?? null);

  useEffect(() => {
    if (openSectionIndex !== null || aboutOpen) return undefined;
    const onWheel = (e) => {
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaMode === 2 ? e.deltaY * 300 : e.deltaY;
      freePos.current = Math.max(0, Math.min(sections.length - 1, freePos.current + delta / PIXELS_PER_SECTION));
      rawTarget.set(freePos.current);
      setIsScrolling(true);
      clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(snapToNearest, SNAP_DELAY_MS);
    };

    window.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", onWheel);
      clearTimeout(snapTimer.current);
    };
  }, [openSectionIndex, aboutOpen, sections.length, rawTarget, snapToNearest]);

  useEffect(() => {
    if (openSectionIndex !== null || aboutOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "ArrowDown") goTo(activeIndex + 1);
      if (e.key === "ArrowUp") goTo(activeIndex - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openSectionIndex, aboutOpen, activeIndex, goTo]);

  useEffect(() => {
    if (openSectionIndex !== null || aboutOpen) return undefined;
    let touchStartY = null;
    let freePosAtStart = 0;

    const onStart = (e) => {
      touchStartY = e.touches[0].clientY;
      freePosAtStart = freePos.current;
      setIsScrolling(true);
      clearTimeout(snapTimer.current);
    };

    const onMove = (e) => {
      if (touchStartY === null) return;
      const delta = touchStartY - e.touches[0].clientY;
      freePos.current = Math.max(0, Math.min(sections.length - 1, freePosAtStart + delta / (window.innerHeight * 0.65)));
      rawTarget.set(freePos.current);
    };

    const onEnd = () => {
      touchStartY = null;
      snapTimer.current = setTimeout(snapToNearest, 80);
    };

    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: true });
    window.addEventListener("touchend", onEnd);

    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
    };
  }, [openSectionIndex, aboutOpen, sections.length, rawTarget, snapToNearest]);

  if (openedSection) {
    return (
      <InlineSectionExperience
        section={openedSection}
        sectionIndex={openSectionIndex}
        heroOnLeft={openedSectionOnLeft}
        site={site}
        onClose={closeSection}
        isActive={Boolean(openedSection && openedSection.id === activeSectionId)}
        sourceParallaxPx={openSectionState?.sourceParallaxPx ?? 0}
        sourceSummaryTop={openSectionState?.sourceSummaryTop ?? null}
        sourceHeroTop={openSectionState?.sourceHeroTop ?? null}
      />
    );
  }

  return (
    <div className="index-root">
      <nav className="index-nav">
        <span className="brand-spacer" aria-hidden="true" />
        <button className="nav-info" onClick={() => { setLabel(""); openAbout(); }}>( About )</button>
      </nav>

      <div className="slide-stage">
        <motion.div className="slider" style={{ y: sliderY }}>
          {sections.map((section, i) => (
            <div
              key={section.id}
              className={`slide ${i % 2 === 0 ? "slide--hero-left" : "slide--hero-right"}`}
              onMouseEnter={() => setLabel("Open")}
              onMouseLeave={() => setLabel("")}
            >
              <HeroPanel section={section} slideIndex={i} smoothTarget={smoothTarget} onOpen={() => openSection(i)} isActive={section.id === activeSectionId} />
              <InfoPanel section={section} sectionIndex={i} smoothTarget={smoothTarget} onOpen={() => openSection(i)} />
            </div>
          ))}
        </motion.div>
      </div>

      <div className="scroll-track">
        <motion.div
          className="scroll-fill"
          animate={{ scaleX: sections.length > 1 ? activeIndex / (sections.length - 1) : 1 }}
          transition={{ duration: 0.4 }}
          style={{ originX: 0 }}
        />
      </div>

      {/* Counter with up/down arrows hidden for now
      <div className="counter">
        <button className="counter-btn" onClick={() => goTo(activeIndex - 1)} disabled={activeIndex === 0}>&#8593;</button>
        <span className="counter-label">{String(activeIndex + 1).padStart(2, "0")} / {String(sections.length).padStart(2, "0")}</span>
        <button className="counter-btn" onClick={() => goTo(activeIndex + 1)} disabled={activeIndex === sections.length - 1}>&#8595;</button>
      </div>
      */}

      <div className="dot-nav">
        {sections.map((s, i) => (
          <button key={s.id} className={`dot${i === activeIndex ? " dot--active" : ""}`} onClick={() => goTo(i)} aria-label={s.title} />
        ))}
      </div>
    </div>
  );
}